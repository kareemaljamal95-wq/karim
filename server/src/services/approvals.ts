import { db, nowIso, parseJson, toJson } from '../db';
import { newId } from '../util/crypto';
import { conflict, notFound } from '../util/errors';
import type { ApprovalKind, ApprovalStatus } from '../types';
import { log } from './logger';

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  entityType: string;
  entityId: string;
  leadId: string | null;
  runId: string | null;
  stepId: string | null;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function mapApproval(row: Record<string, unknown>): Approval {
  return {
    id: String(row.id),
    kind: row.kind as ApprovalKind,
    title: String(row.title),
    summary: String(row.summary ?? ''),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    leadId: (row.lead_id as string) ?? null,
    runId: (row.run_id as string) ?? null,
    stepId: (row.step_id as string) ?? null,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    status: row.status as ApprovalStatus,
    requestedBy: String(row.requested_by),
    decidedBy: (row.decided_by as string) ?? null,
    decidedAt: (row.decided_at as string) ?? null,
    decisionNote: (row.decision_note as string) ?? null,
    createdAt: String(row.created_at),
  };
}

export interface CreateApprovalInput {
  kind: ApprovalKind;
  title: string;
  summary?: string;
  entityType: string;
  entityId: string;
  leadId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  payload?: Record<string, unknown>;
  requestedBy?: string;
}

/**
 * Opens a human approval gate. Every irreversible or externally-visible action
 * in the platform passes through here first.
 */
export function createApproval(input: CreateApprovalInput): Approval {
  // One open gate per entity — re-requesting returns the existing one.
  const existing = db()
    .prepare(
      `SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING'`,
    )
    .get(input.entityType, input.entityId) as Record<string, unknown> | undefined;
  if (existing) return mapApproval(existing);

  const record = {
    id: newId(),
    kind: input.kind,
    title: input.title,
    summary: input.summary ?? '',
    entity_type: input.entityType,
    entity_id: input.entityId,
    lead_id: input.leadId ?? null,
    run_id: input.runId ?? null,
    step_id: input.stepId ?? null,
    payload: toJson(input.payload ?? {}),
    status: 'PENDING' as ApprovalStatus,
    requested_by: input.requestedBy ?? 'orchestrator',
    created_at: nowIso(),
  };

  db()
    .prepare(
      `INSERT INTO approvals (id, kind, title, summary, entity_type, entity_id, lead_id, run_id, step_id,
         payload, status, requested_by, created_at)
       VALUES (@id, @kind, @title, @summary, @entity_type, @entity_id, @lead_id, @run_id, @step_id,
         @payload, @status, @requested_by, @created_at)`,
    )
    .run(record);

  log({
    actorType: 'agent',
    actor: record.requested_by,
    action: 'approval.requested',
    entityType: 'approval',
    entityId: record.id,
    runId: record.run_id,
    message: `Approval requested: ${input.title}`,
    meta: { kind: input.kind, entityType: input.entityType, entityId: input.entityId },
  });

  return mapApproval(record);
}

export function listApprovals(query: { status?: ApprovalStatus; leadId?: string; limit?: number } = {}): Approval[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.status) {
    where.push('status = @status');
    params.status = query.status;
  }
  if (query.leadId) {
    where.push('lead_id = @leadId');
    params.leadId = query.leadId;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db()
    .prepare(
      `SELECT * FROM approvals ${clause}
       ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at DESC
       LIMIT @limit`,
    )
    .all({ ...params, limit: Math.min(query.limit ?? 100, 300) }) as Record<string, unknown>[];
  return rows.map(mapApproval);
}

export function getApproval(id: string): Approval {
  const row = db().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Approval not found');
  return mapApproval(row);
}

export function findPendingApprovalFor(entityType: string, entityId: string): Approval | null {
  const row = db()
    .prepare(`SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING'`)
    .get(entityType, entityId) as Record<string, unknown> | undefined;
  return row ? mapApproval(row) : null;
}

/** Records the decision. Side effects are applied by `approvalFlow`. */
export function recordDecision(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  actor: string,
  note?: string,
): Approval {
  const approval = getApproval(id);
  if (approval.status !== 'PENDING') {
    throw conflict(`This approval was already ${approval.status.toLowerCase()}`);
  }

  db()
    .prepare(
      `UPDATE approvals SET status = @status, decided_by = @decided_by, decided_at = @decided_at,
         decision_note = @note WHERE id = @id`,
    )
    .run({ id, status: decision, decided_by: actor, decided_at: nowIso(), note: note ?? null });

  log({
    actorType: 'user',
    actor,
    action: decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
    entityType: 'approval',
    entityId: id,
    runId: approval.runId,
    message: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'}: ${approval.title}`,
    meta: { note: note ?? null, entityType: approval.entityType, entityId: approval.entityId },
  });

  return getApproval(id);
}

export function pendingApprovalCount(): number {
  return (db().prepare(`SELECT COUNT(*) AS c FROM approvals WHERE status = 'PENDING'`).get() as {
    c: number;
  }).c;
}
