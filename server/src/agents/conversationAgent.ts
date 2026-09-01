import { complete } from '../llm/provider';
import { getSettings } from '../services/settings';
import { Verifier, findForbiddenClaims, findImpersonation } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';

export type ReplyIntent =
  | 'interested'
  | 'asking_question'
  | 'requesting_price'
  | 'requesting_meeting'
  | 'objection'
  | 'not_interested'
  | 'unsubscribe'
  | 'out_of_scope'
  | 'unclear';

export interface ConversationAnalysis {
  intent: ReplyIntent;
  sentiment: 'positive' | 'neutral' | 'negative';
  buyingSignals: string[];
  objections: string[];
  extractedRequirements: string[];
  requiresHuman: boolean;
  humanReason: string | null;
  suggestedReply: string | null;
  /** Whether the suggested reply is safe to queue for approval. */
  replySafe: boolean;
  summary: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'interested',
        'asking_question',
        'requesting_price',
        'requesting_meeting',
        'objection',
        'not_interested',
        'unsubscribe',
        'out_of_scope',
        'unclear',
      ],
    },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    buyingSignals: { type: 'array', items: { type: 'string' } },
    objections: { type: 'array', items: { type: 'string' } },
    extractedRequirements: { type: 'array', items: { type: 'string' } },
    requiresHuman: { type: 'boolean' },
    humanReason: { type: 'string' },
    suggestedReply: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['intent', 'sentiment', 'buyingSignals', 'objections', 'requiresHuman', 'summary'],
  additionalProperties: false,
};

/** Topics an AI agent may never answer on its own authority. */
const ESCALATION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(price|pricing|cost|quote|quotation|how much|budget|fee)\b/i, reason: 'The prospect asked about price.' },
  { pattern: /\b(contract|agreement|terms|legal|nda|invoice|payment terms)\b/i, reason: 'The prospect raised contractual or legal terms.' },
  { pattern: /\b(deadline|timeline|when can you|delivery date|go live)\b/i, reason: 'The prospect asked for a delivery commitment.' },
  { pattern: /\b(discount|cheaper|reduce the price|negotiate)\b/i, reason: 'The prospect opened a negotiation.' },
  { pattern: /\b(complaint|lawyer|refund|cancel)\b/i, reason: 'The message raises a dispute or cancellation.' },
];

const BUYING_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(interested|sounds good|tell me more|keen)\b/i, label: 'Expressed interest' },
  { pattern: /\b(call|meeting|demo|zoom|meet|visit)\b/i, label: 'Asked to talk or meet' },
  { pattern: /\b(we need|we want|we are looking for|looking to)\b/i, label: 'Stated a need' },
  { pattern: /\b(when can we start|next step|how do we proceed)\b/i, label: 'Asked about next steps' },
];

const OBJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(too expensive|no budget|can'?t afford|out of our budget)\b/i, label: 'Budget objection' },
  {
    pattern: /\b(already (have|got|use|using|work(?:ing|ed)? with)|we use|we'?re working with|have an agency)\b/i,
    label: 'Incumbent solution',
  },
  {
    pattern: /\b(not (?:right )?now|maybe later|later this|next (?:quarter|month|year)|too busy|revisit)\b/i,
    label: 'Timing objection',
  },
  { pattern: /\b(don'?t need|no need|not relevant|not a (?:fit|priority))\b/i, label: 'No perceived need' },
  { pattern: /\b(who are you|is this real|scam|spam|how did you get)\b/i, label: 'Trust concern' },
];

/** Explicit declines and opt-outs. Any match stops automated replies entirely. */
const NEGATIVE_PATTERNS =
  /\b(not interested|no thanks|no thank you|thanks anyway|stop contacting|unsubscribe|remove me|do not contact|don'?t contact|leave us alone)\b/i;

/** Opt-outs specifically — these must never receive another message. */
const OPT_OUT_PATTERNS = /\b(unsubscribe|remove me|do not contact|don'?t contact|stop contacting|leave us alone)\b/i;

/**
 * Conversation Agent.
 *
 * Reads an inbound reply, extracts intent and signals, and prepares a suggested
 * response. It escalates rather than answering whenever the prospect touches
 * price, contracts, timelines or anything outside the configured claim list.
 */
export async function runConversationAgent(
  input: {
    businessName: string;
    recommendedServiceLabel: string | null;
    lastOutboundMessage: string | null;
    replyBody: string;
  },
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<ConversationAnalysis>> {
  const config = getAgent('conversation_agent');
  const settings = getSettings();

  let analysis = heuristicAnalysis(input.replyBody, input.businessName, settings);
  let usedLlm = false;
  const notes: string[] = [];

  if (config.enabled) {
    const response = await complete<Partial<ConversationAnalysis>>({
      purpose: 'reply_analysis',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 2000,
      schema: SCHEMA,
      prompt: [
        `Business: ${input.businessName}.`,
        `Service under discussion: ${input.recommendedServiceLabel ?? 'not yet decided'}.`,
        `Services this company actually offers: ${
          settings.offeredServices.length ? settings.offeredServices.join(', ') : 'the full catalogue'
        }.`,
        `Claims you may make: ${settings.approvedClaims.join(' ')}`,
        `Pricing policy: ${settings.pricingPolicy}`,
        '',
        input.lastOutboundMessage ? `Our last message:\n${input.lastOutboundMessage}` : 'No prior message on file.',
        '',
        `Their reply:\n${input.replyBody}`,
        '',
        'Analyse the reply. Quote their wording in buyingSignals and objections. Set requiresHuman to true for anything involving price, contracts, timelines, legal terms or a capability you were not told about, and in that case do not attempt to answer it in suggestedReply — acknowledge and say a colleague will follow up.',
      ].join('\n'),
      parse: (raw) => raw as Partial<ConversationAnalysis>,
    });

    if (response.ok) {
      const merged = mergeAnalysis(analysis, response.data);
      analysis = merged;
      usedLlm = true;
      notes.push(`Analysis by ${response.model}.`);
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  }

  // Escalation is enforced after the model, never delegated to it.
  const escalation = detectEscalation(input.replyBody);
  if (escalation) {
    analysis.requiresHuman = true;
    analysis.humanReason = analysis.humanReason ?? escalation;
  }

  // A suggested reply that breaks a hard rule is discarded, not shown.
  const replyText = analysis.suggestedReply ?? '';
  const claims = findForbiddenClaims(replyText);
  const impersonation = findImpersonation(replyText);
  if (claims.length || impersonation.length) {
    notes.push(
      `Suggested reply discarded: ${[...claims.map((c) => c.reason), ...(impersonation.length ? ['Implied a human sender.'] : [])].join(' ')}`,
    );
    analysis.suggestedReply = safeAcknowledgement(input.businessName, settings.senderName);
    analysis.requiresHuman = true;
    analysis.humanReason = analysis.humanReason ?? 'The drafted reply broke a content rule and was replaced.';
  }
  analysis.replySafe =
    findForbiddenClaims(analysis.suggestedReply ?? '').length === 0 &&
    findImpersonation(analysis.suggestedReply ?? '').length === 0;

  if (analysis.intent === 'unsubscribe' || NEGATIVE_PATTERNS.test(input.replyBody)) {
    analysis.suggestedReply = null;
    analysis.requiresHuman = true;
    analysis.humanReason = 'The prospect asked not to be contacted. Stop all outreach for this lead.';
  }

  const verifier = new Verifier()
    .require(
      'price_questions_escalated',
      !/\b(price|pricing|cost|how much|quote)\b/i.test(input.replyBody) || analysis.requiresHuman,
      'Any pricing question is escalated to a human.',
    )
    .require(
      'no_invented_commitments',
      findForbiddenClaims(analysis.suggestedReply ?? '').length === 0,
      'The suggested reply contains no price, guarantee or delivery commitment.',
    )
    .require(
      'no_human_impersonation',
      findImpersonation(analysis.suggestedReply ?? '').length === 0,
      'The suggested reply does not imply a human sender.',
    )
    .require(
      'opt_out_respected',
      !NEGATIVE_PATTERNS.test(input.replyBody) || analysis.suggestedReply === null,
      'An opt-out request produces no automated reply.',
    )
    .expect(
      'signals_quote_the_reply',
      analysis.buyingSignals.every((s) => s.length > 0),
      'Buying signals are backed by the prospect’s own wording.',
    )
    .expect(
      'reply_requires_approval',
      true,
      'The suggested reply is a draft and still requires human approval before sending.',
    );

  return outcome('conversation_agent', analysis, verifier.report(), usedLlm, notes);
}

function detectEscalation(text: string): string | null {
  for (const { pattern, reason } of ESCALATION_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

function mergeAnalysis(base: ConversationAnalysis, patch: Partial<ConversationAnalysis>): ConversationAnalysis {
  return {
    intent: (patch.intent as ReplyIntent) ?? base.intent,
    sentiment: patch.sentiment ?? base.sentiment,
    // Union of both so a heuristic hit is never lost when the model misses it.
    buyingSignals: dedupe([...(patch.buyingSignals ?? []), ...base.buyingSignals]),
    objections: dedupe([...(patch.objections ?? []), ...base.objections]),
    extractedRequirements: dedupe([
      ...(patch.extractedRequirements ?? []),
      ...base.extractedRequirements,
    ]),
    requiresHuman: Boolean(patch.requiresHuman) || base.requiresHuman,
    humanReason: patch.humanReason ?? base.humanReason,
    suggestedReply: patch.suggestedReply ?? base.suggestedReply,
    replySafe: base.replySafe,
    summary: patch.summary ?? base.summary,
  };
}

const dedupe = (items: string[]): string[] => Array.from(new Set(items.map((i) => i.trim()).filter(Boolean)));

function heuristicAnalysis(
  reply: string,
  businessName: string,
  settings: ReturnType<typeof getSettings>,
): ConversationAnalysis {
  const buyingSignals = BUYING_PATTERNS.filter((p) => p.pattern.test(reply)).map((p) => p.label);
  const objections = OBJECTION_PATTERNS.filter((p) => p.pattern.test(reply)).map((p) => p.label);
  const escalation = detectEscalation(reply);

  let intent: ReplyIntent = 'unclear';
  if (OPT_OUT_PATTERNS.test(reply)) intent = 'unsubscribe';
  else if (NEGATIVE_PATTERNS.test(reply)) intent = 'not_interested';
  else if (/\b(price|how much|cost|quote)\b/i.test(reply)) intent = 'requesting_price';
  else if (/\b(call|meeting|demo|meet)\b/i.test(reply)) intent = 'requesting_meeting';
  else if (objections.length) intent = 'objection';
  else if (buyingSignals.length) intent = 'interested';
  else if (/\?/.test(reply)) intent = 'asking_question';

  const sentiment: ConversationAnalysis['sentiment'] = NEGATIVE_PATTERNS.test(reply)
    ? 'negative'
    : buyingSignals.length
      ? 'positive'
      : 'neutral';

  const requiresHuman = Boolean(escalation) || intent === 'not_interested' || intent === 'unsubscribe';

  return {
    intent,
    sentiment,
    buyingSignals,
    objections,
    extractedRequirements: extractRequirements(reply),
    requiresHuman,
    humanReason: escalation,
    suggestedReply:
      intent === 'unsubscribe' || intent === 'not_interested'
        ? null
        : safeAcknowledgement(businessName, settings.senderName),
    replySafe: true,
    summary: `Reply from ${businessName} classified as "${intent}" with ${buyingSignals.length} buying signal(s) and ${objections.length} objection(s).`,
  };
}

function extractRequirements(reply: string): string[] {
  const found: string[] = [];
  const map: { pattern: RegExp; label: string }[] = [
    { pattern: /\bdelivery\b/i, label: 'Delivery' },
    { pattern: /\bpayment|checkout|pay online\b/i, label: 'Online payment' },
    { pattern: /\bbooking|appointment|reservation\b/i, label: 'Booking / appointments' },
    { pattern: /\bordering|order online|menu\b/i, label: 'Online ordering' },
    { pattern: /\bapp\b/i, label: 'Mobile application' },
    { pattern: /\bwebsite\b/i, label: 'Website' },
    { pattern: /\bwhatsapp\b/i, label: 'WhatsApp channel' },
    { pattern: /\bdashboard|admin|reports?\b/i, label: 'Admin dashboard' },
    { pattern: /\bloyalty|points|rewards\b/i, label: 'Loyalty programme' },
    { pattern: /\bmultiple branches|branches|locations\b/i, label: 'Multi-branch support' },
  ];
  for (const { pattern, label } of map) if (pattern.test(reply)) found.push(label);
  return found;
}

const safeAcknowledgement = (businessName: string, senderName: string): string =>
  `Thank you for getting back to us. I'm an AI assistant, so I've passed your message to ${senderName}, who will follow up personally with the details. If it helps, let us know a good time for a short call with ${businessName}.`;
