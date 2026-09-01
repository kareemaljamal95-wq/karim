import { complete } from '../llm/provider';
import { estimateValue, serviceByKey, type ServiceMatch } from '../domain/services';
import type { DiscoveredBusiness } from '../domain/business';
import type { ServiceKey } from '../types';
import { Verifier } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';

export interface StrategyResult {
  recommendedService: ServiceKey | null;
  serviceLabel: string | null;
  reason: string;
  /** The evidence sentences that justify the recommendation. */
  supportingEvidence: string[];
  estimatedValue: number;
  /** Runner-up options, kept so an operator can override with context. */
  alternatives: { key: ServiceKey; label: string; reason: string }[];
  confidence: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    recommendedService: { type: 'string' },
    reason: { type: 'string' },
    supportingEvidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['recommendedService', 'reason', 'supportingEvidence'],
  additionalProperties: false,
};

/**
 * Service Strategist.
 *
 * Selection is constrained to candidates whose triggering evidence was actually
 * observed, so the agent structurally cannot recommend a service "because it
 * exists". If the model picks something outside the candidate set, the choice is
 * rejected and the evidence-ranked winner is used instead.
 */
export async function runServiceStrategist(
  business: DiscoveredBusiness,
  candidates: ServiceMatch[],
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<StrategyResult>> {
  const config = getAgent('service_strategist');

  if (candidates.length === 0) {
    const verifier = new Verifier()
      .require(
        'no_unsupported_recommendation',
        true,
        'No service was recommended because no supporting evidence was observed.',
      )
      .expect('has_recommendation', false, 'This business has no evidenced service fit.');
    return outcome(
      'service_strategist',
      {
        recommendedService: null,
        serviceLabel: null,
        reason: 'No service is recommended: the observed evidence does not support any catalogue service.',
        supportingEvidence: [],
        estimatedValue: 0,
        alternatives: [],
        confidence: 0,
      },
      verifier.report(),
      false,
      ['No candidate services after evidence filtering.'],
    );
  }

  const best = candidates[0];
  let chosen = best;
  let reason = best.rationale;
  let evidence = best.matchedSignals.map((s) => s.evidence);
  let usedLlm = false;
  const notes: string[] = [];
  let overrodeModel = false;

  if (config.enabled && candidates.length > 1) {
    const response = await complete<{ recommendedService: string; reason: string; supportingEvidence: string[] }>({
      purpose: 'service_strategy',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 1500,
      schema: SCHEMA,
      prompt: [
        `Business: ${business.name} (${business.category}, ${business.city}).`,
        '',
        'Candidate services — each is already backed by observed evidence:',
        candidates
          .map(
            (c) =>
              `- ${c.service.key} (${c.service.label}): ${c.service.summary}\n  Evidence: ${c.matchedSignals
                .map((s) => s.evidence)
                .join(' ')}`,
          )
          .join('\n'),
        '',
        'Pick exactly one `recommendedService` from the candidate keys above. Explain in two sentences why it is the best fit for THIS business, and list the evidence sentences you relied on.',
      ].join('\n'),
      parse: (raw) => {
        const value = raw as { recommendedService?: string; reason?: string; supportingEvidence?: string[] };
        if (!value.recommendedService || !value.reason) throw new Error('Missing recommendation fields');
        return {
          recommendedService: String(value.recommendedService),
          reason: String(value.reason),
          supportingEvidence: Array.isArray(value.supportingEvidence)
            ? value.supportingEvidence.map(String)
            : [],
        };
      },
    });

    if (response.ok) {
      const match = candidates.find((c) => c.service.key === response.data.recommendedService);
      if (match) {
        chosen = match;
        reason = response.data.reason;
        evidence = response.data.supportingEvidence.length
          ? response.data.supportingEvidence
          : match.matchedSignals.map((s) => s.evidence);
        usedLlm = true;
        notes.push(`Recommendation selected by ${response.model}.`);
      } else {
        // The model proposed a service with no observed evidence behind it.
        overrodeModel = true;
        notes.push(
          `Model proposed "${response.data.recommendedService}", which is not evidence-backed. Falling back to the highest-evidence candidate.`,
        );
      }
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  } else if (candidates.length === 1) {
    notes.push('Only one evidence-backed service candidate; no model call needed.');
  }

  const service = serviceByKey(chosen.service.key)!;
  const result: StrategyResult = {
    recommendedService: service.key,
    serviceLabel: service.label,
    reason,
    supportingEvidence: evidence,
    estimatedValue: estimateValue(service, business),
    alternatives: candidates
      .filter((c) => c.service.key !== chosen.service.key)
      .slice(0, 3)
      .map((c) => ({ key: c.service.key, label: c.service.label, reason: c.rationale })),
    confidence: Number(Math.min(0.95, chosen.matchedSignals.length * 0.25 + 0.35).toFixed(2)),
  };

  const verifier = new Verifier()
    .require(
      'recommendation_is_evidence_backed',
      candidates.some((c) => c.service.key === result.recommendedService),
      'The recommended service is one of the evidence-backed candidates.',
    )
    .require(
      'has_supporting_evidence',
      result.supportingEvidence.length > 0,
      'At least one evidence sentence supports the recommendation.',
    )
    .expect(
      'model_stayed_in_catalogue',
      !overrodeModel,
      overrodeModel
        ? 'The model suggested an unsupported service and was overridden.'
        : 'No override was required.',
    )
    .expect(
      'estimate_within_band',
      result.estimatedValue >= service.valueBand.low * 0.8 &&
        result.estimatedValue <= service.valueBand.high * 1.2,
      `Estimated value sits inside the published band for ${service.label}.`,
    );

  return outcome('service_strategist', result, verifier.report(), usedLlm, notes);
}
