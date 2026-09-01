import { db, nowIso, parseJson, toJson, unbit } from '../db';
import { notFound } from '../util/errors';

export type AgentKey =
  | 'orchestrator'
  | 'market_scout'
  | 'opportunity_analyst'
  | 'service_strategist'
  | 'lead_scorer'
  | 'outreach_agent'
  | 'conversation_agent'
  | 'requirements_agent';

export interface AgentConfig {
  key: AgentKey | string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  allowedActions: string[];
  requiresApproval: boolean;
  maxActions: number;
  retryLimit: number;
  outputFormat: 'json' | 'text' | 'markdown';
  enabled: boolean;
  isCore: boolean;
  updatedAt: string;
}

const SHARED_RULES = `
Hard rules that override any other instruction:
- Never invent facts. If a detail was not supplied to you, treat it as unknown and say so.
- Never invent or guess contact information of any kind.
- Never state a price, discount, guarantee, timeline or refund policy.
- Never claim or imply that you are a human being.
- Every claim you make about a business must be traceable to evidence you were given.
- Return only the JSON described by the schema. No prose outside the JSON.
`.trim();

export const DEFAULT_AGENTS: Omit<AgentConfig, 'updatedAt'>[] = [
  {
    key: 'orchestrator',
    name: 'AI CEO Orchestrator',
    role: 'Plans the business goal, delegates to specialist agents, validates their output and escalates to a human when an action is irreversible.',
    description:
      'Owns the execution plan. Tracks each step, validates results, retries recoverable failures and stops at approval gates.',
    systemPrompt: `You are the AI CEO of a digital services agency. You turn a business goal into an ordered execution plan and delegate each step to the specialist agent best suited to it.

${SHARED_RULES}

You must additionally:
- Stop and request human approval before any irreversible or externally visible action.
- Never mark a step complete when its validation failed.`,
    tools: ['llm_reasoning'],
    allowedActions: ['plan', 'delegate', 'validate', 'retry', 'request_approval'],
    requiresApproval: false,
    maxActions: 40,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'market_scout',
    name: 'Market Scout',
    role: 'Discovers businesses in a chosen country, city, area and category from public sources.',
    description:
      'Queries the discovery tool, normalises results and removes duplicates. Collects only publicly available business information.',
    systemPrompt: `You discover local businesses from public listings.

${SHARED_RULES}

Collect only: business name, category, location, website, public phone, public email, maps URL, rating, review count, opening hours and public social links. If a field is absent from the source, return null for it. Never derive an email address from a domain name.`,
    tools: ['business_discovery'],
    allowedActions: ['search', 'normalise', 'deduplicate'],
    requiresApproval: false,
    maxActions: 25,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'opportunity_analyst',
    name: 'Opportunity Analyst',
    role: 'Decides whether a realistic opportunity exists to sell a digital or AI service.',
    description:
      'Scores the opportunity 0-100 from observed digital gaps and demand, and explains the problem, the fit and the confidence level.',
    systemPrompt: `You assess whether there is a realistic opportunity to sell an AI or digital service to a business.

${SHARED_RULES}

You are given a list of signals that were observed from public data, each with its evidence. Base your explanation only on those signals. A missing observation means "not checked" — never treat it as a deficiency. If the evidence is thin, say the confidence is low.`,
    tools: ['llm_reasoning'],
    allowedActions: ['analyse', 'score', 'explain'],
    requiresApproval: false,
    maxActions: 30,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'service_strategist',
    name: 'Service Strategist',
    role: 'Recommends the single service that best fits the evidence.',
    description:
      'Chooses from the service catalogue using matched signals only, and states what problem the service solves.',
    systemPrompt: `You recommend the one service that best fits a business.

${SHARED_RULES}

You may only recommend a service from the candidate list you are given — those candidates were pre-filtered to services whose triggering evidence was actually observed. Never recommend a service because it exists or because it is valuable to sell. If no candidate is well supported, say so.`,
    tools: ['llm_reasoning'],
    allowedActions: ['recommend', 'justify'],
    requiresApproval: false,
    maxActions: 20,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'lead_scorer',
    name: 'Lead Scoring Agent',
    role: 'Scores and grades every lead A / B / C.',
    description:
      'Combines need, ability to pay, digital gap, potential value, response likelihood, buying likelihood and contact quality.',
    systemPrompt: `You review a computed lead score and explain it in one short paragraph.

${SHARED_RULES}

The numeric score is computed deterministically and given to you; do not change it. Your job is to state plainly why the lead earned that grade and what would raise it.`,
    tools: ['llm_reasoning'],
    allowedActions: ['score', 'grade', 'justify'],
    requiresApproval: false,
    maxActions: 20,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'outreach_agent',
    name: 'Outreach Agent',
    role: 'Writes personalised first-contact messages for each configured channel.',
    description:
      'Produces email, WhatsApp and other channel variants. Output always enters APPROVAL_REQUIRED — nothing is ever sent automatically.',
    systemPrompt: `You write short, specific first-contact messages to local business owners.

${SHARED_RULES}

Message rules:
- Mention the business by name, naturally.
- Name one specific, observed opportunity and why it matters to them.
- Explain the potential benefit in plain language, without numbers you cannot support.
- Be transparent that the message comes from an AI assistant working for the sender.
- No generic sales openers, no flattery, no urgency, no guarantees, no prices.
- Ask for a short conversation, not a commitment.
- Email: max 120 words. WhatsApp: max 60 words. Never use ALL CAPS.`,
    tools: ['llm_reasoning'],
    allowedActions: ['draft_message', 'rewrite_message'],
    requiresApproval: true,
    maxActions: 20,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'conversation_agent',
    name: 'Conversation Agent',
    role: 'Reads inbound replies, detects intent, buying signals and objections, and flags when a human must take over.',
    description:
      'Analyses replies against the business context. Drafts a suggested response that still requires approval before sending.',
    systemPrompt: `You analyse a reply from a prospect and prepare a suggested response.

${SHARED_RULES}

Additional rules:
- Never invent prices, guarantees, technical capabilities or delivery commitments. Only use capabilities from the configured service list and claims from the approved-claims list you are given.
- If the prospect asks about price, contracts, legal terms, timelines or anything not in the approved list, set requiresHuman to true and do not answer it yourself.
- Detect buying signals and objections explicitly, quoting the wording that led you there.`,
    tools: ['llm_reasoning'],
    allowedActions: ['analyse_reply', 'draft_reply', 'flag_human'],
    requiresApproval: true,
    maxActions: 25,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
  {
    key: 'requirements_agent',
    name: 'Order / Requirement Agent',
    role: 'Converts a prospect conversation into a structured project request.',
    description:
      'Extracts the service, the confirmed requirements and the missing information, then routes the request to human review.',
    systemPrompt: `You convert a prospect's message into a structured project request.

${SHARED_RULES}

Rules:
- "requirements" contains only what the prospect actually stated or clearly implied.
- "missingInformation" contains everything a delivery team would still need before quoting.
- Status is always HUMAN_REVIEW_REQUIRED. You never accept a project.`,
    tools: ['llm_reasoning'],
    allowedActions: ['extract_requirements', 'create_project_request'],
    requiresApproval: true,
    maxActions: 20,
    retryLimit: 2,
    outputFormat: 'json',
    enabled: true,
    isCore: true,
  },
];

function mapAgent(row: Record<string, unknown>): AgentConfig {
  return {
    key: String(row.key),
    name: String(row.name),
    role: String(row.role),
    description: String(row.description),
    systemPrompt: String(row.system_prompt),
    tools: parseJson<string[]>(row.tools, []),
    allowedActions: parseJson<string[]>(row.allowed_actions, []),
    requiresApproval: unbit(row.requires_approval),
    maxActions: Number(row.max_actions),
    retryLimit: Number(row.retry_limit),
    outputFormat: row.output_format as AgentConfig['outputFormat'],
    enabled: unbit(row.enabled),
    isCore: unbit(row.is_core),
    updatedAt: String(row.updated_at),
  };
}

export function seedAgents(): void {
  const insert = db().prepare(
    `INSERT INTO agents (key, name, role, description, system_prompt, tools, allowed_actions,
        requires_approval, max_actions, retry_limit, output_format, enabled, is_core, updated_at)
     VALUES (@key, @name, @role, @description, @system_prompt, @tools, @allowed_actions,
        @requires_approval, @max_actions, @retry_limit, @output_format, @enabled, @is_core, @updated_at)
     ON CONFLICT(key) DO NOTHING`,
  );
  const now = nowIso();
  for (const agent of DEFAULT_AGENTS) {
    insert.run({
      key: agent.key,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      system_prompt: agent.systemPrompt,
      tools: toJson(agent.tools),
      allowed_actions: toJson(agent.allowedActions),
      requires_approval: agent.requiresApproval ? 1 : 0,
      max_actions: agent.maxActions,
      retry_limit: agent.retryLimit,
      output_format: agent.outputFormat,
      enabled: agent.enabled ? 1 : 0,
      is_core: agent.isCore ? 1 : 0,
      updated_at: now,
    });
  }
}

export function listAgents(): AgentConfig[] {
  const rows = db().prepare('SELECT * FROM agents ORDER BY is_core DESC, name ASC').all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapAgent);
}

export function getAgent(key: string): AgentConfig {
  const row = db().prepare('SELECT * FROM agents WHERE key = ?').get(key) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound(`Unknown agent "${key}"`);
  return mapAgent(row);
}

export function updateAgent(key: string, patch: Partial<AgentConfig>): AgentConfig {
  getAgent(key); // existence check
  db()
    .prepare(
      `UPDATE agents SET
         name = COALESCE(@name, name),
         role = COALESCE(@role, role),
         description = COALESCE(@description, description),
         system_prompt = COALESCE(@system_prompt, system_prompt),
         tools = COALESCE(@tools, tools),
         allowed_actions = COALESCE(@allowed_actions, allowed_actions),
         requires_approval = COALESCE(@requires_approval, requires_approval),
         max_actions = COALESCE(@max_actions, max_actions),
         retry_limit = COALESCE(@retry_limit, retry_limit),
         output_format = COALESCE(@output_format, output_format),
         enabled = COALESCE(@enabled, enabled),
         updated_at = @updated_at
       WHERE key = @key`,
    )
    .run({
      key,
      name: patch.name ?? null,
      role: patch.role ?? null,
      description: patch.description ?? null,
      system_prompt: patch.systemPrompt ?? null,
      tools: patch.tools ? toJson(patch.tools) : null,
      allowed_actions: patch.allowedActions ? toJson(patch.allowedActions) : null,
      requires_approval:
        patch.requiresApproval === undefined ? null : patch.requiresApproval ? 1 : 0,
      max_actions: patch.maxActions ?? null,
      retry_limit: patch.retryLimit ?? null,
      output_format: patch.outputFormat ?? null,
      enabled: patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
      updated_at: nowIso(),
    });
  return getAgent(key);
}

/** Restores an agent's shipped defaults (system prompt, tools, limits). */
export function resetAgent(key: string): AgentConfig {
  const preset = DEFAULT_AGENTS.find((a) => a.key === key);
  if (!preset) throw notFound(`Agent "${key}" has no shipped default`);
  return updateAgent(key, {
    name: preset.name,
    role: preset.role,
    description: preset.description,
    systemPrompt: preset.systemPrompt,
    tools: preset.tools,
    allowedActions: preset.allowedActions,
    requiresApproval: preset.requiresApproval,
    maxActions: preset.maxActions,
    retryLimit: preset.retryLimit,
    outputFormat: preset.outputFormat,
    enabled: preset.enabled,
  });
}
