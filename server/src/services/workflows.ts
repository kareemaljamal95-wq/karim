import { bit, db, nowIso, parseJson, toJson, unbit } from '../db';
import { newId } from '../util/crypto';
import { badRequest, notFound } from '../util/errors';
import {
  validateDefinition,
  type Workflow,
  type WorkflowDefinition,
} from '../orchestrator/workflowTypes';

/**
 * The shipped default pipeline:
 * find businesses → research → score → recommend service → save leads →
 * filter by quality → generate message → human approval → send → analyse reply → notify.
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      label: 'Market research request',
      description: 'Started manually from the Market Research page with a country, city, area and category.',
      config: { kind: 'manual' },
    },
    {
      id: 'discover',
      type: 'agent',
      agent: 'market_scout',
      label: 'Find businesses',
      description:
        'Discovers businesses from Google Places or OpenStreetMap, or clearly-labelled demo data when neither is connected.',
      config: { limit: 12 },
    },
    {
      id: 'verify',
      type: 'tool',
      tool: 'website_inspection',
      label: 'Verify each website',
      description:
        "Visits each business's own site and records what is actually there — booking, ordering, chat, socials, a published email — so the analyst reasons from observed pages instead of missing data. Skipped when the connector is off.",
      config: {},
    },
    {
      id: 'analyse',
      type: 'agent',
      agent: 'opportunity_analyst',
      label: 'Research & score opportunity',
      description: 'Detects digital gaps from observed evidence and scores the opportunity 0-100.',
      config: {},
    },
    {
      id: 'strategy',
      type: 'agent',
      agent: 'service_strategist',
      label: 'Recommend a service',
      description: 'Picks the single best-supported service from the catalogue.',
      config: {},
    },
    {
      id: 'score',
      type: 'agent',
      agent: 'lead_scorer',
      label: 'Score & grade the lead',
      description: 'Scores across seven dimensions and assigns grade A, B or C.',
      config: {},
    },
    {
      id: 'save',
      type: 'action',
      label: 'Save to lead database',
      description: 'Upserts each business as a lead, skipping duplicates.',
      config: { action: 'save_leads' },
    },
    {
      id: 'qualify',
      type: 'condition',
      label: 'Qualified for outreach?',
      description: 'Only leads above the score threshold with a usable contact channel continue.',
      config: { field: 'leadScore', operator: '>=', value: 60 },
    },
    {
      id: 'draft',
      type: 'agent',
      agent: 'outreach_agent',
      label: 'Generate personalised message',
      description: 'Drafts an email and a WhatsApp variant referencing the observed opportunity.',
      config: { channels: ['email', 'whatsapp'] },
    },
    {
      id: 'approval',
      type: 'approval',
      label: 'Human approval',
      description: 'Every first message waits here. Nothing is sent without a human decision.',
      config: { kind: 'FIRST_OUTREACH' },
    },
    {
      id: 'send',
      type: 'action',
      label: 'Send (after approval)',
      description:
        'Dispatch only happens when sending is enabled and a channel integration is connected. Otherwise the message stays queued.',
      config: { action: 'send_after_approval' },
    },
    {
      id: 'notify',
      type: 'action',
      label: 'Notify the CEO',
      description: 'Writes the run summary to the activity log.',
      config: { action: 'notify' },
    },
  ],
  edges: [
    { from: 'trigger', to: 'discover' },
    { from: 'discover', to: 'verify' },
    { from: 'verify', to: 'analyse' },
    { from: 'analyse', to: 'strategy' },
    { from: 'strategy', to: 'score' },
    { from: 'score', to: 'save' },
    { from: 'save', to: 'qualify' },
    { from: 'qualify', to: 'draft', when: 'pass' },
    { from: 'qualify', to: 'notify', when: 'fail' },
    { from: 'draft', to: 'approval' },
    { from: 'approval', to: 'send' },
    { from: 'send', to: 'notify' },
  ],
};

function mapWorkflow(row: Record<string, unknown>): Workflow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    definition: parseJson<WorkflowDefinition>(row.definition, { nodes: [], edges: [] }),
    enabled: unbit(row.enabled),
    isDefault: unbit(row.is_default),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Adds the website-verification step to an existing default workflow.
 *
 * Installs created before the step existed still run the old graph, and the
 * workflow is data rather than code, so shipping the node is not enough. This
 * only rewires a graph that still matches the shipped shape in that region —
 * a workflow an operator has edited is left exactly as they left it.
 */
function addVerificationStep(): void {
  const row = db().prepare('SELECT id, definition FROM workflows WHERE is_default = 1').get() as
    | { id: string; definition: string }
    | undefined;
  if (!row) return;

  const definition = parseJson<WorkflowDefinition>(row.definition, { nodes: [], edges: [] });
  const hasDiscover = definition.nodes.some((node) => node.id === 'discover');
  const hasVerify = definition.nodes.some((node) => node.id === 'verify');
  const shippedEdge = definition.edges.find((edge) => edge.from === 'discover' && edge.to === 'analyse');
  if (!hasDiscover || hasVerify || !shippedEdge) return;

  const verifyNode = DEFAULT_WORKFLOW.nodes.find((node) => node.id === 'verify');
  if (!verifyNode) return;

  const discoverAt = definition.nodes.findIndex((node) => node.id === 'discover');
  definition.nodes.splice(discoverAt + 1, 0, verifyNode);
  definition.edges = [
    ...definition.edges.filter((edge) => edge !== shippedEdge),
    { from: 'discover', to: 'verify' },
    { from: 'verify', to: 'analyse' },
  ];

  db()
    .prepare('UPDATE workflows SET definition = @definition, updated_at = @updated_at WHERE id = @id')
    .run({ id: row.id, definition: toJson(definition), updated_at: nowIso() });
}

export function seedWorkflows(): void {
  const existing = db().prepare('SELECT COUNT(*) AS c FROM workflows').get() as { c: number };
  if (existing.c > 0) {
    addVerificationStep();
    return;
  }
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO workflows (id, name, description, definition, enabled, is_default, created_at, updated_at)
       VALUES (@id, @name, @description, @definition, 1, 1, @created_at, @updated_at)`,
    )
    .run({
      id: newId(),
      name: 'Local business discovery → approved outreach',
      description:
        'The default end-to-end pipeline: discover businesses, research and score them, recommend a service, draft outreach and hold it for human approval.',
      definition: toJson(DEFAULT_WORKFLOW),
      created_at: now,
      updated_at: now,
    });
}

export function listWorkflows(): Workflow[] {
  const rows = db()
    .prepare('SELECT * FROM workflows ORDER BY is_default DESC, created_at ASC')
    .all() as Record<string, unknown>[];
  return rows.map(mapWorkflow);
}

export function getWorkflow(id: string): Workflow {
  const row = db().prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Workflow not found');
  return mapWorkflow(row);
}

export function getDefaultWorkflow(): Workflow {
  const row = db()
    .prepare('SELECT * FROM workflows WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  if (!row) {
    seedWorkflows();
    return getDefaultWorkflow();
  }
  return mapWorkflow(row);
}

export function createWorkflow(input: {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}): Workflow {
  const problems = validateDefinition(input.definition);
  if (problems.length) throw badRequest('The workflow definition is invalid', problems);

  const id = newId();
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO workflows (id, name, description, definition, enabled, is_default, created_at, updated_at)
       VALUES (@id, @name, @description, @definition, 1, 0, @created_at, @updated_at)`,
    )
    .run({
      id,
      name: input.name,
      description: input.description ?? '',
      definition: toJson(input.definition),
      created_at: now,
      updated_at: now,
    });
  return getWorkflow(id);
}

export function updateWorkflow(
  id: string,
  patch: { name?: string; description?: string; definition?: WorkflowDefinition; enabled?: boolean },
): Workflow {
  getWorkflow(id);
  if (patch.definition) {
    const problems = validateDefinition(patch.definition);
    if (problems.length) throw badRequest('The workflow definition is invalid', problems);
  }
  db()
    .prepare(
      `UPDATE workflows SET
         name = COALESCE(@name, name),
         description = COALESCE(@description, description),
         definition = COALESCE(@definition, definition),
         enabled = COALESCE(@enabled, enabled),
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      name: patch.name ?? null,
      description: patch.description ?? null,
      definition: patch.definition ? toJson(patch.definition) : null,
      enabled: patch.enabled === undefined ? null : bit(patch.enabled),
      updated_at: nowIso(),
    });
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): void {
  const workflow = getWorkflow(id);
  if (workflow.isDefault) throw badRequest('The default workflow cannot be deleted');
  db().prepare('DELETE FROM workflows WHERE id = ?').run(id);
}
