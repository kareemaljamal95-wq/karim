import { complete } from '../llm/provider';
import { getSettings } from '../services/settings';
import { Verifier, findForbiddenClaims, findImpersonation, findSpamPhrases } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';
import type { MessageChannel } from '../types';

export interface OutreachSubject {
  businessName: string;
  category: string;
  city: string;
  recommendedServiceLabel: string | null;
  /** The single strongest observed problem, in plain language. */
  problem: string;
  /** Evidence sentences the message may reference. */
  evidence: string[];
  benefit: string;
  /** What the recommended service does, in the customer's terms. */
  serviceSummary?: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface DraftedMessage {
  channel: MessageChannel;
  subject: string | null;
  body: string;
  wordCount: number;
  quality: MessageQuality;
}

export interface MessageQuality {
  mentionsBusinessName: boolean;
  referencesEvidence: boolean;
  disclosesAi: boolean;
  spamPhrases: string[];
  forbiddenClaims: { phrase: string; reason: string }[];
  impersonation: string[];
  withinLengthLimit: boolean;
  score: number;
}

export interface OutreachResult {
  messages: DraftedMessage[];
  /** Always true in the MVP: nothing leaves the platform without a human. */
  requiresApproval: true;
}

const CHANNEL_LIMITS: Record<MessageChannel, number> = {
  email: 130,
  whatsapp: 65,
  sms: 45,
  linkedin: 90,
};

const SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: ['email', 'whatsapp', 'sms', 'linkedin'] },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['channel', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['messages'],
  additionalProperties: false,
};

/**
 * Outreach Agent.
 *
 * Drafts one message per requested channel. Every draft is scored against the
 * message-quality rules; a draft that impersonates a human, quotes a price or
 * reads like spam is rejected and replaced with the safe template, so a bad
 * draft can never reach the approval queue unflagged.
 */
export async function runOutreachAgent(
  subject: OutreachSubject,
  channels: MessageChannel[],
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<OutreachResult>> {
  const config = getAgent('outreach_agent');
  const settings = getSettings();
  const requested = channels.length ? channels : (['email', 'whatsapp'] as MessageChannel[]);

  let drafts: DraftedMessage[] = requested.map((channel) => buildTemplate(channel, subject, settings));
  let usedLlm = false;
  const notes: string[] = [];
  const rejected: string[] = [];

  if (config.enabled) {
    const response = await complete<{ messages: { channel: string; subject?: string; body: string }[] }>({
      purpose: 'outreach_drafting',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 2500,
      schema: SCHEMA,
      prompt: [
        `Sender: ${settings.senderName}, ${settings.senderRole} at ${settings.companyName}. The sender is an AI assistant working on behalf of that company; say so plainly in each message.`,
        '',
        `Recipient business: ${subject.businessName} — a ${subject.category} in ${subject.city}.`,
        `Observed problem: ${subject.problem}`,
        `Evidence you may reference: ${subject.evidence.join(' ')}`,
        `Service being offered: ${subject.recommendedServiceLabel ?? 'a short conversation about their setup'}`,
        `Benefit to them: ${subject.benefit}`,
        '',
        `Claims you are allowed to make (nothing beyond these): ${settings.approvedClaims.join(' ')}`,
        `Pricing policy: ${settings.pricingPolicy}`,
        '',
        `Write one message per channel: ${requested.join(', ')}.`,
        `Word limits — ${requested.map((c) => `${c}: ${CHANNEL_LIMITS[c]}`).join(', ')}.`,
        'Email needs a subject line under 8 words. Other channels have no subject.',
        'Close by asking for a short call. Never state a price, a guarantee or a statistic.',
      ].join('\n'),
      parse: (raw) => {
        const value = raw as { messages?: { channel?: string; subject?: string; body?: string }[] };
        if (!Array.isArray(value.messages) || value.messages.length === 0) {
          throw new Error('No messages returned');
        }
        return {
          messages: value.messages.map((m) => ({
            channel: String(m.channel ?? 'email'),
            subject: m.subject ? String(m.subject) : undefined,
            body: String(m.body ?? ''),
          })),
        };
      },
    });

    if (response.ok) {
      const accepted: DraftedMessage[] = [];
      for (const channel of requested) {
        const generated = response.data.messages.find((m) => m.channel === channel);
        if (!generated || !generated.body.trim()) {
          accepted.push(buildTemplate(channel, subject, settings));
          continue;
        }
        const draft = assess(channel, generated.subject ?? null, generated.body.trim(), subject);
        // A draft that breaks a hard rule never reaches a human as-is.
        if (draft.quality.forbiddenClaims.length || draft.quality.impersonation.length || draft.quality.spamPhrases.length) {
          rejected.push(
            `${channel}: replaced with the safe template (${[
              ...draft.quality.forbiddenClaims.map((c) => c.reason),
              ...(draft.quality.impersonation.length ? ['Implied the sender is human.'] : []),
              ...(draft.quality.spamPhrases.length ? ['Contained spam phrasing.'] : []),
            ].join(' ')})`,
          );
          accepted.push(buildTemplate(channel, subject, settings));
        } else {
          accepted.push(draft);
        }
      }
      drafts = accepted;
      usedLlm = rejected.length < requested.length;
      notes.push(`Drafted by ${response.model}.`);
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  }

  for (const note of rejected) notes.push(note);

  const verifier = new Verifier()
    .require(
      'no_forbidden_claims',
      drafts.every((d) => d.quality.forbiddenClaims.length === 0),
      'No message states a price, guarantee or unverifiable statistic.',
    )
    .require(
      'no_human_impersonation',
      drafts.every((d) => d.quality.impersonation.length === 0),
      'No message claims or implies the sender is a human being.',
    )
    .require(
      'discloses_ai',
      drafts.every((d) => d.quality.disclosesAi),
      'Every message discloses that it comes from an AI assistant.',
    )
    .require(
      'mentions_business',
      drafts.every((d) => d.quality.mentionsBusinessName),
      'Every message names the business it is addressed to.',
    )
    .require(
      'requires_approval',
      true,
      'The drafts enter APPROVAL_REQUIRED; nothing is sent automatically.',
    )
    .expect(
      'no_spam_language',
      drafts.every((d) => d.quality.spamPhrases.length === 0),
      'No generic spam phrasing was used.',
    )
    .expect(
      'references_real_evidence',
      drafts.every((d) => d.quality.referencesEvidence),
      'Each message points at a specific observed opportunity.',
    )
    .expect(
      'within_length_limits',
      drafts.every((d) => d.quality.withinLengthLimit),
      'Each message respects its channel length limit.',
    );

  if (!subject.hasEmail && requested.includes('email')) {
    verifier.warn('No public email address is on file — the email variant cannot be delivered yet.');
  }

  return outcome('outreach_agent', { messages: drafts, requiresApproval: true }, verifier.report(), usedLlm, notes);
}

function assess(
  channel: MessageChannel,
  subjectLine: string | null,
  body: string,
  context: OutreachSubject,
): DraftedMessage {
  const full = `${subjectLine ?? ''} ${body}`;
  const lower = full.toLowerCase();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  const evidenceWords = context.evidence
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 6);

  const quality: MessageQuality = {
    mentionsBusinessName: lower.includes(context.businessName.toLowerCase()),
    referencesEvidence:
      evidenceWords.some((w) => lower.includes(w)) ||
      (context.recommendedServiceLabel
        ? lower.includes(context.recommendedServiceLabel.toLowerCase().split(' ')[0])
        : false),
    disclosesAi: /\bai\b|automated assistant|ai assistant/i.test(full),
    spamPhrases: findSpamPhrases(full),
    forbiddenClaims: findForbiddenClaims(full),
    impersonation: findImpersonation(full),
    withinLengthLimit: wordCount <= CHANNEL_LIMITS[channel],
    score: 0,
  };

  quality.score = scoreQuality(quality);

  return {
    channel,
    subject: channel === 'email' ? subjectLine ?? defaultSubject(context) : null,
    body,
    wordCount,
    quality,
  };
}

function scoreQuality(q: MessageQuality): number {
  let score = 100;
  if (!q.mentionsBusinessName) score -= 20;
  if (!q.referencesEvidence) score -= 20;
  if (!q.disclosesAi) score -= 25;
  if (!q.withinLengthLimit) score -= 10;
  score -= q.spamPhrases.length * 15;
  score -= q.forbiddenClaims.length * 30;
  score -= q.impersonation.length * 40;
  return Math.max(0, Math.min(100, score));
}

const defaultSubject = (context: OutreachSubject): string =>
  context.recommendedServiceLabel
    ? `${context.businessName}: a quick idea about ${context.recommendedServiceLabel.toLowerCase()}`
    : `A quick question about ${context.businessName}`;

/**
 * Safe fallback copy. Used when no model is configured and whenever a generated
 * draft fails a hard rule. It is deliberately plain: specific, short, honest
 * about being AI-generated, and free of any claim the platform cannot support.
 */
function buildTemplate(
  channel: MessageChannel,
  context: OutreachSubject,
  settings: ReturnType<typeof getSettings>,
): DraftedMessage {
  const service = context.recommendedServiceLabel ?? 'a small improvement to how customers reach you';
  const evidence = context.evidence[0] ?? context.problem;
  // Name the service once, then say what it does — the internal scoring
  // sentence ("supported by 1 observed signal") is for the operator's audit
  // trail, never for the business owner reading the message.
  const remedy = context.serviceSummary
    ? `${withArticle(service)} would cover that — ${lowerFirst(context.serviceSummary)}`
    : `${withArticle(service)} would cover that.`;

  const email = [
    `Hello ${context.businessName} team,`,
    '',
    `I'm an AI assistant working with ${settings.senderName} at ${settings.companyName}. While looking at ${context.category} businesses in ${context.city}, I noticed one thing about your setup: ${lowerFirst(evidence)}`,
    '',
    remedy,
    '',
    `If that is worth ten minutes, ${settings.senderName} would be glad to talk it through — no obligation. If it is not relevant, just reply "no thanks" and we will not follow up.`,
    '',
    `— ${settings.senderName}, ${settings.senderRole}, ${settings.companyName}`,
  ].join('\n');

  const whatsapp = [
    `Hello ${context.businessName} — I'm an AI assistant working with ${settings.companyName}.`,
    `I noticed ${lowerFirst(evidence)} ${remedy}`,
    `Would a short call with ${settings.senderName} be useful? Reply "no thanks" and we'll stop here.`,
  ].join(' ');

  const short = `Hello ${context.businessName} — AI assistant from ${settings.companyName} here. I noticed ${lowerFirst(evidence)} Would a short call be useful?`;

  const body = channel === 'email' ? email : channel === 'whatsapp' ? whatsapp : short;
  return assess(channel, channel === 'email' ? defaultSubject(context) : null, body, context);
}

const lowerFirst = (value: string): string =>
  value.length ? value.charAt(0).toLowerCase() + value.slice(1) : value;

/** "Ordering system" -> "An ordering system", so the sentence reads naturally. */
const withArticle = (label: string): string => {
  const lower = lowerFirst(label);
  return `${/^[aeiou]/i.test(lower) ? 'An' : 'A'} ${lower}`;
};
