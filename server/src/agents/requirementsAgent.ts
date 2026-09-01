import { complete } from '../llm/provider';
import { SERVICE_CATALOG, serviceByKey } from '../domain/services';
import { Verifier, findForbiddenClaims } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';

export interface ProjectRequest {
  service: string;
  serviceKey: string | null;
  requirements: string[];
  missingInformation: string[];
  /** Always HUMAN_REVIEW_REQUIRED — the agent never accepts a project. */
  status: 'HUMAN_REVIEW_REQUIRED';
  title: string;
  notes: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    service: { type: 'string' },
    serviceKey: { type: 'string' },
    title: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
    missingInformation: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['service', 'requirements', 'missingInformation', 'title'],
  additionalProperties: false,
};

/** Information a delivery team always needs before it can quote. */
const STANDARD_MISSING = [
  'Budget range',
  'Timeline / launch date',
  'Branding assets (logo, colours, imagery)',
  'Decision maker and approval process',
];

const CONDITIONAL_MISSING: { trigger: RegExp; items: string[] }[] = [
  { trigger: /delivery/i, items: ['Delivery zones and fees'] },
  { trigger: /payment|checkout/i, items: ['Payment provider'] },
  { trigger: /booking|appointment/i, items: ['Staff, services and slot durations'] },
  { trigger: /ordering|menu/i, items: ['Menu / catalogue source and update process'] },
  { trigger: /app|application/i, items: ['Target platforms (iOS, Android, both)'] },
  { trigger: /multi|branch|location/i, items: ['Number of branches and per-branch differences'] },
  { trigger: /integration|erp|pos/i, items: ['Existing systems to integrate with'] },
];

/**
 * Order / Requirement Agent.
 *
 * Converts a prospect's message into a structured project request. It records
 * only what the prospect actually said and lists everything still unknown —
 * then routes the request to a human. It never accepts work or quotes a price.
 */
export async function runRequirementsAgent(
  input: {
    businessName: string;
    category: string;
    recommendedServiceLabel: string | null;
    conversationText: string;
  },
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<ProjectRequest>> {
  const config = getAgent('requirements_agent');

  let request = heuristicExtract(input);
  let usedLlm = false;
  const notes: string[] = [];

  if (config.enabled) {
    const response = await complete<Partial<ProjectRequest>>({
      purpose: 'requirement_extraction',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 2000,
      schema: SCHEMA,
      prompt: [
        `Business: ${input.businessName} (${input.category}).`,
        `Service previously recommended: ${input.recommendedServiceLabel ?? 'none'}.`,
        `Service catalogue keys: ${SERVICE_CATALOG.map((s) => s.key).join(', ')}.`,
        '',
        'What the prospect said:',
        input.conversationText,
        '',
        'Produce a structured project request. `requirements` must contain only things the prospect actually stated or clearly implied. `missingInformation` must list everything a delivery team would still need before quoting. Do not include prices, effort estimates or commitments.',
      ].join('\n'),
      parse: (raw) => raw as Partial<ProjectRequest>,
    });

    if (response.ok) {
      const data = response.data;
      request = {
        service: data.service ? String(data.service) : request.service,
        serviceKey: data.serviceKey && serviceByKey(String(data.serviceKey)) ? String(data.serviceKey) : request.serviceKey,
        title: data.title ? String(data.title) : request.title,
        requirements: dedupe([...(data.requirements ?? []).map(String), ...request.requirements]),
        // Union with the standard list so nothing essential is dropped.
        missingInformation: dedupe([
          ...(data.missingInformation ?? []).map(String),
          ...request.missingInformation,
        ]),
        status: 'HUMAN_REVIEW_REQUIRED',
        notes: data.notes ? String(data.notes) : request.notes,
      };
      usedLlm = true;
      notes.push(`Extraction by ${response.model}.`);
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  }

  const combined = `${request.service} ${request.requirements.join(' ')} ${request.notes}`;
  const verifier = new Verifier()
    .require(
      'status_is_human_review',
      request.status === 'HUMAN_REVIEW_REQUIRED',
      'The request is routed to human review; the agent never accepts a project.',
    )
    .require(
      'no_commitments',
      findForbiddenClaims(combined).length === 0,
      'The request contains no price, guarantee or delivery commitment.',
    )
    .require(
      'missing_info_listed',
      request.missingInformation.length > 0,
      'Open questions are explicitly listed rather than assumed.',
    )
    .expect(
      'requirements_extracted',
      request.requirements.length > 0,
      request.requirements.length > 0
        ? `${request.requirements.length} requirement(s) captured from the conversation.`
        : 'No concrete requirement could be extracted from the conversation.',
    );

  return outcome('requirements_agent', request, verifier.report(), usedLlm, notes);
}

function heuristicExtract(input: {
  businessName: string;
  category: string;
  recommendedServiceLabel: string | null;
  conversationText: string;
}): ProjectRequest {
  const text = input.conversationText;
  const requirements: string[] = [];

  const map: { trigger: RegExp; label: string }[] = [
    { trigger: /\bcustomer app|mobile app|\bapp\b/i, label: 'Customer mobile app' },
    { trigger: /\bonline order|ordering|order online\b/i, label: 'Online ordering' },
    { trigger: /\bmenu\b/i, label: 'Menu management' },
    { trigger: /\bpayment|checkout|pay online\b/i, label: 'Online payment' },
    { trigger: /\bdelivery\b/i, label: 'Delivery' },
    { trigger: /\bpickup|collection\b/i, label: 'Pickup / collection' },
    { trigger: /\badmin|dashboard|back ?office\b/i, label: 'Admin dashboard' },
    { trigger: /\bbooking|appointment|reservation\b/i, label: 'Booking / appointments' },
    { trigger: /\bwebsite\b/i, label: 'Website' },
    { trigger: /\bwhatsapp\b/i, label: 'WhatsApp channel' },
    { trigger: /\bloyalty|rewards|points\b/i, label: 'Loyalty programme' },
    { trigger: /\breport|analytics\b/i, label: 'Reporting / analytics' },
    { trigger: /\bnotification|sms|push\b/i, label: 'Customer notifications' },
    { trigger: /\bmulti|branch|location\b/i, label: 'Multi-branch support' },
  ];
  for (const { trigger, label } of map) if (trigger.test(text)) requirements.push(label);

  const missing = [...STANDARD_MISSING];
  for (const { trigger, items } of CONDITIONAL_MISSING) {
    if (trigger.test(text)) missing.push(...items);
  }
  // If the prospect named a feature we would need details for, and did not give
  // them, that gap belongs in missingInformation rather than being guessed.
  if (requirements.includes('Delivery') && !/zone|area|radius|km/i.test(text)) {
    missing.push('Delivery zones');
  }

  const inferredService = inferService(text, input.recommendedServiceLabel, input.category);

  return {
    service: inferredService.label,
    serviceKey: inferredService.key,
    title: `${inferredService.label} for ${input.businessName}`,
    requirements: dedupe(requirements),
    missingInformation: dedupe(missing),
    status: 'HUMAN_REVIEW_REQUIRED',
    notes: 'Extracted deterministically from the prospect conversation.',
  };
}

function inferService(
  text: string,
  recommended: string | null,
  category: string,
): { key: string | null; label: string } {
  if (/\bapp\b/i.test(text) && /\border|delivery|menu\b/i.test(text)) {
    return { key: 'ordering_system', label: `${titleCase(category)} ordering application` };
  }
  if (/\bapp\b/i.test(text)) return { key: 'mobile_application', label: 'Mobile application' };
  if (/\bbooking|appointment\b/i.test(text)) return { key: 'booking_system', label: 'Booking system' };
  if (/\bordering|menu|order online\b/i.test(text)) return { key: 'ordering_system', label: 'Ordering system' };
  if (/\bwebsite\b/i.test(text)) return { key: 'website', label: 'Website' };
  if (/\bwhatsapp|chatbot|assistant\b/i.test(text)) {
    return { key: 'whatsapp_website_ai_assistant', label: 'WhatsApp / website AI assistant' };
  }
  const fromRecommendation = SERVICE_CATALOG.find((s) => s.label === recommended);
  if (fromRecommendation) return { key: fromRecommendation.key, label: fromRecommendation.label };
  return { key: null, label: recommended ?? 'Scoping required' };
}

const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const dedupe = (items: string[]): string[] =>
  Array.from(new Set(items.map((i) => i.trim()).filter(Boolean)));
