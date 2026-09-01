import { db, nowIso, parseJson, toJson } from '../db';
import { newId } from '../util/crypto';
import { badRequest, notFound } from '../util/errors';
import { log } from './logger';
import type { ProjectRequest } from '../agents/requirementsAgent';

export type ProjectStatus =
  | 'HUMAN_REVIEW_REQUIRED'
  | 'SCOPING'
  | 'PROPOSAL_SENT'
  | 'ACCEPTED'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'DECLINED';

export const PROJECT_STATUSES: ProjectStatus[] = [
  'HUMAN_REVIEW_REQUIRED',
  'SCOPING',
  'PROPOSAL_SENT',
  'ACCEPTED',
  'IN_DELIVERY',
  'DELIVERED',
  'DECLINED',
];

/** Statuses that represent a commercial commitment and therefore need approval. */
export const COMMITMENT_STATUSES: ProjectStatus[] = ['ACCEPTED', 'IN_DELIVERY', 'DELIVERED'];

export interface Project {
  id: string;
  leadId: string;
  leadName: string;
  title: string;
  service: string;
  requirements: string[];
  missingInformation: string[];
  status: ProjectStatus;
  estimatedValue: number | null;
  sourceConversationId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    leadName: String(row.lead_name ?? ''),
    title: String(row.title),
    service: String(row.service),
    requirements: parseJson<string[]>(row.requirements, []),
    missingInformation: parseJson<string[]>(row.missing_info, []),
    status: row.status as ProjectStatus,
    estimatedValue:
      row.estimated_value === null || row.estimated_value === undefined
        ? null
        : Number(row.estimated_value),
    sourceConversationId: (row.source_conversation_id as string) ?? null,
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const SELECT_WITH_LEAD = `
  SELECT p.*, l.business_name AS lead_name
  FROM projects p
  JOIN leads l ON l.id = p.lead_id
`;

export function createProject(input: {
  leadId: string;
  request: ProjectRequest;
  estimatedValue?: number | null;
  sourceConversationId?: string | null;
}): Project {
  const id = newId();
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO projects (id, lead_id, title, service, requirements, missing_info, status,
         estimated_value, source_conversation_id, notes, created_at, updated_at)
       VALUES (@id, @lead_id, @title, @service, @requirements, @missing_info, 'HUMAN_REVIEW_REQUIRED',
         @estimated_value, @source_conversation_id, @notes, @created_at, @updated_at)`,
    )
    .run({
      id,
      lead_id: input.leadId,
      title: input.request.title,
      service: input.request.service,
      requirements: toJson(input.request.requirements),
      missing_info: toJson(input.request.missingInformation),
      estimated_value: input.estimatedValue ?? null,
      source_conversation_id: input.sourceConversationId ?? null,
      notes: input.request.notes,
      created_at: now,
      updated_at: now,
    });

  log({
    actorType: 'agent',
    actor: 'requirements_agent',
    action: 'project.created',
    entityType: 'project',
    entityId: id,
    message: `Project request "${input.request.title}" created and routed to human review`,
    meta: { missingInformation: input.request.missingInformation },
  });

  return getProject(id);
}

export function getProject(id: string): Project {
  const row = db().prepare(`${SELECT_WITH_LEAD} WHERE p.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Project not found');
  return mapProject(row);
}

export function listProjects(query: { status?: ProjectStatus; leadId?: string } = {}): Project[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.status) {
    where.push('p.status = @status');
    params.status = query.status;
  }
  if (query.leadId) {
    where.push('p.lead_id = @leadId');
    params.leadId = query.leadId;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db().prepare(`${SELECT_WITH_LEAD} ${clause} ORDER BY p.created_at DESC`).all(params) as Record<
    string,
    unknown
  >[];
  return rows.map(mapProject);
}

export function updateProject(
  id: string,
  patch: {
    status?: ProjectStatus;
    notes?: string;
    requirements?: string[];
    missingInformation?: string[];
    estimatedValue?: number | null;
  },
  actor: string,
): Project {
  const before = getProject(id);
  if (patch.status && !PROJECT_STATUSES.includes(patch.status)) {
    throw badRequest(`Unknown project status "${patch.status}"`);
  }

  db()
    .prepare(
      `UPDATE projects SET
         status = COALESCE(@status, status),
         notes = COALESCE(@notes, notes),
         requirements = COALESCE(@requirements, requirements),
         missing_info = COALESCE(@missing_info, missing_info),
         estimated_value = COALESCE(@estimated_value, estimated_value),
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: patch.status ?? null,
      notes: patch.notes ?? null,
      requirements: patch.requirements ? toJson(patch.requirements) : null,
      missing_info: patch.missingInformation ? toJson(patch.missingInformation) : null,
      estimated_value: patch.estimatedValue ?? null,
      updated_at: nowIso(),
    });

  if (patch.status && patch.status !== before.status) {
    log({
      actorType: 'user',
      actor,
      action: 'project.status_changed',
      entityType: 'project',
      entityId: id,
      message: `Project "${before.title}": ${before.status} → ${patch.status}`,
    });
  }

  return getProject(id);
}
