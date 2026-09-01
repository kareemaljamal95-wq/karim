import { db, nowIso, toJson, parseJson } from '../db';
import { newId } from '../util/crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ActorType = 'user' | 'agent' | 'system';

export interface LogInput {
  level?: LogLevel;
  actorType?: ActorType;
  actor?: string;
  action: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  runId?: string | null;
  meta?: Record<string, unknown>;
}

export interface ActivityLog {
  id: string;
  ts: string;
  level: LogLevel;
  actorType: ActorType;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  runId: string | null;
  message: string;
  meta: Record<string, unknown>;
}

/**
 * Append-only audit log. Every agent action, approval decision and external
 * side effect lands here — it is the system's accountability record.
 */
export function log(input: LogInput): ActivityLog {
  const row = {
    id: newId(),
    ts: nowIso(),
    level: input.level ?? 'info',
    actor_type: input.actorType ?? 'system',
    actor: input.actor ?? 'system',
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    run_id: input.runId ?? null,
    message: input.message,
    meta: toJson(input.meta ?? {}),
  };
  db()
    .prepare(
      `INSERT INTO activity_logs (id, ts, level, actor_type, actor, action, entity_type, entity_id, run_id, message, meta)
       VALUES (@id, @ts, @level, @actor_type, @actor, @action, @entity_type, @entity_id, @run_id, @message, @meta)`,
    )
    .run(row);
  return mapLog(row);
}

export interface LogQuery {
  level?: LogLevel;
  actorType?: ActorType;
  entityType?: string;
  entityId?: string;
  runId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listLogs(query: LogQuery = {}): { items: ActivityLog[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.level) {
    where.push('level = @level');
    params.level = query.level;
  }
  if (query.actorType) {
    where.push('actor_type = @actorType');
    params.actorType = query.actorType;
  }
  if (query.entityType) {
    where.push('entity_type = @entityType');
    params.entityType = query.entityType;
  }
  if (query.entityId) {
    where.push('entity_id = @entityId');
    params.entityId = query.entityId;
  }
  if (query.runId) {
    where.push('run_id = @runId');
    params.runId = query.runId;
  }
  if (query.search) {
    where.push('(message LIKE @search OR action LIKE @search OR actor LIKE @search)');
    params.search = `%${query.search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(query.limit ?? 100, 500);
  const offset = query.offset ?? 0;

  const total = db().prepare(`SELECT COUNT(*) AS c FROM activity_logs ${clause}`).get(params) as {
    c: number;
  };
  const rows = db()
    .prepare(`SELECT * FROM activity_logs ${clause} ORDER BY ts DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as Record<string, unknown>[];

  return { items: rows.map(mapLog), total: total.c };
}

export function mapLog(row: Record<string, unknown>): ActivityLog {
  return {
    id: String(row.id),
    ts: String(row.ts),
    level: row.level as LogLevel,
    actorType: row.actor_type as ActorType,
    actor: String(row.actor),
    action: String(row.action),
    entityType: (row.entity_type as string) ?? null,
    entityId: (row.entity_id as string) ?? null,
    runId: (row.run_id as string) ?? null,
    message: String(row.message),
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
  };
}
