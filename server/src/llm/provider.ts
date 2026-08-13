import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { getCredentials, isActive, recordIntegrationCheck } from '../services/integrations';
import { log } from '../services/logger';

export interface LlmRequest<T> {
  /** Stable system prompt — kept first so the prompt cache prefix survives. */
  system: string;
  /** Per-request user content. */
  prompt: string;
  /** JSON schema the response must satisfy. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** Label used in logs and step metadata. */
  purpose: string;
  runId?: string | null;
  /** Validates/normalises the parsed payload. Throwing rejects the completion. */
  parse: (raw: unknown) => T;
}

export type LlmOutcome<T> =
  | { ok: true; data: T; model: string; usage: { input: number; output: number } }
  | { ok: false; reason: 'unavailable' | 'refusal' | 'error' | 'invalid_output'; message: string };

export function llmAvailable(): boolean {
  return isActive('anthropic');
}

function client(): Anthropic {
  const apiKey = getCredentials('anthropic').apiKey;
  return new Anthropic({ apiKey });
}

/**
 * Single entry point for model calls.
 *
 * Every agent goes through here so that: (a) the deterministic engine can take
 * over transparently when no key is configured, (b) refusals and malformed
 * output become typed outcomes rather than exceptions, and (c) usage is
 * audited centrally.
 */
export async function complete<T>(request: LlmRequest<T>): Promise<LlmOutcome<T>> {
  if (!llmAvailable()) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'No Anthropic API key configured — deterministic engine used instead.',
    };
  }

  try {
    const params = {
      model: env.anthropicModel,
      max_tokens: request.maxTokens ?? 8000,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: env.llmEffort,
        format: { type: 'json_schema', schema: request.schema },
      },
      messages: [{ role: 'user', content: request.prompt }],
    } as unknown as Anthropic.MessageCreateParamsNonStreaming;

    const response = await client().messages.create(params);

    // Safety classifiers can decline; check before touching content.
    if (response.stop_reason === 'refusal') {
      log({
        level: 'warn',
        actorType: 'system',
        actor: 'llm',
        action: 'llm.refusal',
        runId: request.runId ?? null,
        message: `Model declined the "${request.purpose}" request`,
        meta: { purpose: request.purpose },
      });
      return { ok: false, reason: 'refusal', message: 'The model declined this request.' };
    }

    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        reason: 'invalid_output',
        message: 'Model output was truncated before completing the JSON payload.',
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      return { ok: false, reason: 'invalid_output', message: 'Model returned no text content.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'invalid_output', message: 'Model output was not valid JSON.' };
    }

    const data = request.parse(parsed);
    recordIntegrationCheck('anthropic', null);

    return {
      ok: true,
      data,
      model: response.model,
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model error';
    recordIntegrationCheck('anthropic', message);
    log({
      level: 'warn',
      actorType: 'system',
      actor: 'llm',
      action: 'llm.error',
      runId: request.runId ?? null,
      message: `Model call for "${request.purpose}" failed: ${message}`,
      meta: { purpose: request.purpose },
    });
    return { ok: false, reason: 'error', message };
  }
}
