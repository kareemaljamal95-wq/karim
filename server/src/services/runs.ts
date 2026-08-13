import { bit, db, nowIso, parseJson, toJson, unbit } from '../db';
import { newId } from '../util/crypto';
import { notFound } from '../util/errors';
import type { RunStatus, StepStatus } from '../types';
import type { ValidationReport } from '../agents/verification';

export interface PlanStep {
  nodeId: string;
  label: string;
  kind: string;
  agentKey: string | null;
}

export interface RunStep {
  id: string;
  runId: string;
  seq: number;
  nodeId: string;
  label: string;
  agentKey: string | null;
  kind: string;
  status: StepStatus;
  attempts: number;
  input: Record<string, unknown>;
  output: unknown;
  validation: ValidationReport | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Run {
  id: string;
  workflowId: string | null;
  goal: string;
  status: RunStatus;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  plan: PlanStep[];
  error: string | null;
  demo: boolean;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: RunStep[];
}

function mapStep(row: Record<string, unknown>): RunStep {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    seq: Number(row.seq),
    nodeId: String(row.node_id),
    label: String(row.label),
    agentKey: (row.agent_key as string) ?? null,
    kind: String(row.kind),
    status: row.status as StepStatus,
    attempts: Number(row.attempts),
    input: parseJson<Record<string, unknown>>(row.input, {}),
    output: row.output ? parseJson<unknown>(row.output, null) : null,
    validation: row.validation ? parseJson<ValidationReport | null>(row.validation, null) : null,
    error: (row.error as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    finishedAt: (row.finished_at as string) ?? null,
  };
}

function mapRun(row: Record<string, unknown>, steps: RunStep[]): Run {
  return {
    id: String(row.id),
    workflowId: (row.workflow_id as string) ?? null,
    goal: String(row.goal),
    status: row.status as RunStatus,
    input: parseJson<Record<string, unknown>>(row.input, {}),
    context: parseJson<Record<string, unknown>>(row.context, {}),
    plan: parseJson<PlanStep[]>(row.plan, []),
    error: (row.error as string) ?? null,
    demo: unbit(row.demo),
    startedBy: (row.started_by as string) ?? null,
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string) ?? null,
    steps,
  };
}

export function createRun(input: {
  workflowId: string | null;
  goal: string;
  input: Record<string, unknown>;
  plan: PlanStep[];
  startedBy: string | null;
}): string {
  const id = newId();
  db()
    .prepare(
      `INSERT INTO runs (id, workflow_id, goal, status, input, context, plan, demo, started_by, started_at)
       VALUES (@id, @workflow_id, @goal, 'RUNNING', @input, '{}', @plan, 0, @started_by, @started_at)`,
    )
    .run({
      id,
      workflow_id: input.workflowId,
      goal: input.goal,
      input: toJson(input.input),
      plan: toJson(input.plan),
      started_by: input.startedBy,
      started_at: nowIso(),
    });
  return id;
}

export function startStep(input: {
  runId: string;
  seq: number;
  nodeId: string;
  label: string;
  kind: string;
  agentKey: string | null;
  stepInput: Record<string, unknown>;
}): string {
  const id = newId();
  db()
    .prepare(
      `INSERT INTO run_steps (id, run_id, seq, node_id, label, agent_key, kind, status, attempts, input, started_at)
       VALUES (@id, @run_id, @seq, @node_id, @label, @agent_key, @kind, 'RUNNING', 0, @input, @started_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      seq: input.seq,
      node_id: input.nodeId,
      label: input.label,
      agent_key: input.agentKey,
      kind: input.kind,
      input: toJson(input.stepInput),
      started_at: nowIso(),
    });
  return id;
}

export function finishStep(
  stepId: string,
  update: {
    status: StepStatus;
    output?: unknown;
    validation?: ValidationReport | null;
    error?: string | null;
    attempts?: number;
  },
): void {
  db()
    .prepare(
      `UPDATE run_steps SET status = @status, output = @output, validation = @validation,
         error = @error, attempts = COALESCE(@attempts, attempts), finished_at = @finished_at
       WHERE id = @id`,
    )
    .run({
      id: stepId,
      status: update.status,
      output: update.output === undefined ? null : toJson(update.output),
      validation: update.validation ? toJson(update.validation) : null,
      error: update.error ?? null,
      attempts: update.attempts ?? null,
      finished_at: nowIso(),
    });
}

export function updateRun(
  runId: string,
  update: { status?: RunStatus; context?: Record<string, unknown>; error?: string | null; demo?: boolean },
): void {
  const finished =
    update.status && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(update.status) ? nowIso() : null;
  db()
    .prepare(
      `UPDATE runs SET
         status = COALESCE(@status, status),
         context = COALESCE(@context, context),
         error = COALESCE(@error, error),
         demo = COALESCE(@demo, demo),
         finished_at = COALESCE(@finished_at, finished_at)
       WHERE id = @id`,
    )
    .run({
      id: runId,
      status: update.status ?? null,
      context: update.context ? toJson(update.context) : null,
      error: update.error ?? null,
      demo: update.demo === undefined ? null : bit(update.demo),
      finished_at: finished,
    });
}

export function getRun(id: string): Run {
  const row = db().prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Run not found');
  const steps = (
    db().prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC').all(id) as Record<
      string,
      unknown
    >[]
  ).map(mapStep);
  return mapRun(row, steps);
}

export function listRuns(limit = 25): Run[] {
  const rows = db()
    .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
    .all(Math.min(limit, 100)) as Record<string, unknown>[];
  return rows.map((row) => {
    const steps = (
      db()
        .prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC')
        .all(String(row.id)) as Record<string, unknown>[]
    ).map(mapStep);
    return mapRun(row, steps);
  });
}

export function recordResearchRun(input: {
  runId: string | null;
  country: string;
  city: string;
  area: string;
  category: string;
  source: string;
  demo: boolean;
  discovered: number;
  imported: number;
  duplicates: number;
  createdBy: string | null;
}): string {
  const id = newId();
  db()
    .prepare(
      `INSERT INTO research_runs (id, run_id, country, city, area, category, source, demo,
         discovered, imported, duplicates, created_by, created_at)
       VALUES (@id, @run_id, @country, @city, @area, @category, @source, @demo,
         @discovered, @imported, @duplicates, @created_by, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      country: input.country,
      city: input.city,
      area: input.area,
      category: input.category,
      source: input.source,
      demo: bit(input.demo),
      discovered: input.discovered,
      imported: input.imported,
      duplicates: input.duplicates,
      created_by: input.createdBy,
      created_at: nowIso(),
    });
  return id;
}

export interface ResearchRunView {
  id: string;
  runId: string | null;
  country: string;
  city: string;
  area: string;
  category: string;
  source: string;
  demo: boolean;
  discovered: number;
  imported: number;
  duplicates: number;
  createdBy: string | null;
  createdAt: string;
}

export function listResearchRuns(limit = 50): ResearchRunView[] {
  const rows = db()
    .prepare('SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(limit, 200)) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    runId: (row.run_id as string) ?? null,
    country: String(row.country),
    city: String(row.city),
    area: String(row.area ?? ''),
    category: String(row.category),
    source: String(row.source),
    demo: unbit(row.demo),
    discovered: Number(row.discovered),
    imported: Number(row.imported),
    duplicates: Number(row.duplicates),
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
  }));
}

/** Marks a step as waiting on a human decision. */
export function markStepWaiting(stepId: string, output: unknown, validation: ValidationReport | null): void {
  finishStep(stepId, { status: 'WAITING_APPROVAL', output, validation });
}
