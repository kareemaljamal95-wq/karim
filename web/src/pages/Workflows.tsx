import { useState } from 'react';
import {
  ArrowDown,
  Bot,
  CheckSquare,
  GitBranch,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { cx, relativeTime, titleCase } from '../lib/format';
import {
  Badge,
  Card,
  ErrorBlock,
  Field,
  InfoNote,
  LoadingBlock,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
} from '../components/ui';
import type { Workflow, WorkflowNode } from '../lib/types';

interface WorkflowsResponse {
  items: Workflow[];
  palette: {
    agents: { key: string; name: string; enabled: boolean }[];
    tools: { key: string; name: string }[];
    nodeTypes: string[];
    conditionFields: string[];
    actions: string[];
    approvalKinds: string[];
  };
}

const NODE_ICONS: Record<string, typeof Zap> = {
  trigger: Zap,
  agent: Bot,
  tool: Wrench,
  condition: GitBranch,
  approval: ShieldCheck,
  action: Sparkles,
};

const NODE_TONES: Record<string, string> = {
  trigger: 'border-slate-300 bg-slate-50 dark:border-white/15 dark:bg-white/[0.05]',
  agent: 'border-brand-200 bg-brand-50/60 dark:border-brand-500/25 dark:bg-brand-500/10',
  tool: 'border-slate-300 bg-white dark:border-white/15 dark:bg-white/[0.04]',
  condition: 'border-violet-200 bg-violet-50/60 dark:border-violet-500/25 dark:bg-violet-500/10',
  approval: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10',
  action: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10',
};

/**
 * Workflow builder. The graph rendered here is the graph the orchestrator walks —
 * editing a node's config (a condition threshold, the outreach channels, the
 * approval kind) genuinely changes what the next run does.
 */
export function WorkflowsPage() {
  const { can } = useAuth();
  const { data, loading, error, refetch } = useQuery<WorkflowsResponse>('/workflows');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null);
  const { run, pending } = useAction();

  if (loading) return <LoadingBlock label="Loading workflows" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  const active = draft ?? data.items.find((w) => w.id === selectedId) ?? data.items[0];
  if (!active) return null;

  const nodes = active.definition.nodes;
  const edges = active.definition.edges;

  const updateNode = (updated: WorkflowNode) => {
    const next: Workflow = {
      ...active,
      definition: {
        ...active.definition,
        nodes: nodes.map((node) => (node.id === updated.id ? updated : node)),
      },
    };
    setDraft(next);
    setEditingNode(null);
  };

  const save = async () => {
    if (!draft) return;
    const result = await run(
      () => api(`/workflows/${draft.id}`, { method: 'PATCH', body: { definition: draft.definition } }),
      { success: 'Workflow saved' },
    );
    if (result) {
      setDraft(null);
      refetch();
    }
  };

  const validate = () =>
    run<{ valid: boolean; problems: string[] }>(
      () => api('/workflows/validate', { method: 'POST', body: active.definition }),
      {
        onSuccess: (result) => {
          if (!result) return;
          run(async () => result, {
            success: result.valid
              ? 'Definition is valid.'
              : `${result.problems.length} problem(s): ${result.problems.join(' ')}`,
          });
        },
      },
    );

  // Branch edges are drawn beside the node they leave, so a `fail` path is visible.
  const branchesFrom = (nodeId: string) =>
    edges.filter((edge) => edge.from === nodeId && edge.when === 'fail');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="The execution graph the AI CEO follows: trigger → agent → condition → approval → action."
        actions={
          <>
            <select
              className="input w-auto"
              value={active.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setDraft(null);
              }}
            >
              {data.items.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                  {workflow.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={validate} disabled={pending}>
              <Play className="h-4 w-4" />
              Validate
            </button>
            {can('admin') && (
              <button type="button" className="btn-primary" onClick={save} disabled={pending || !draft}>
                {pending ? <Spinner /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            )}
          </>
        }
      />

      {draft && (
        <InfoNote tone="warning">
          You have unsaved changes to this workflow. They only affect runs after you save.
        </InfoNote>
      )}

      <Card>
        <SectionTitle hint={`${nodes.length} nodes · updated ${relativeTime(active.updatedAt)}`}>
          {active.name}
        </SectionTitle>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{active.description}</p>

        <div className="mx-auto max-w-2xl">
          {nodes.map((node, index) => {
            const Icon = NODE_ICONS[node.type] ?? Sparkles;
            const failEdges = branchesFrom(node.id);
            return (
              <div key={node.id}>
                <button
                  type="button"
                  onClick={() => can('admin') && setEditingNode(node)}
                  className={cx(
                    'w-full rounded-2xl border p-4 text-left transition',
                    NODE_TONES[node.type],
                    can('admin') && 'hover:-translate-y-0.5 hover:shadow-md',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 text-slate-700 shadow-sm dark:bg-white/10 dark:text-slate-200">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{node.label}</span>
                        <Badge tone="neutral">{node.type}</Badge>
                        {node.agent && <Badge tone="brand">{node.agent.replace(/_/g, ' ')}</Badge>}
                      </div>
                      {node.description && (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{node.description}</p>
                      )}
                      <NodeConfigSummary node={node} />
                    </div>
                  </div>
                </button>

                {failEdges.map((edge) => (
                  <p key={`${edge.from}-${edge.to}`} className="ml-6 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    ↳ if it fails the condition → <strong>{nodes.find((n) => n.id === edge.to)?.label ?? edge.to}</strong>
                  </p>
                ))}

                {index < nodes.length - 1 && (
                  <div className="flex justify-center py-2 text-slate-300 dark:text-slate-600">
                    <ArrowDown className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle>Approval gates in this workflow</SectionTitle>
          {nodes.filter((n) => n.type === 'approval').length === 0 ? (
            <InfoNote tone="warning">
              This workflow has no approval gate. Any workflow that can produce external messages should have one.
            </InfoNote>
          ) : (
            <ul className="space-y-2">
              {nodes
                .filter((n) => n.type === 'approval')
                .map((node) => (
                  <li key={node.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <CheckSquare className="h-4 w-4 text-amber-500" />
                    {node.label} — {titleCase(String(node.config?.kind ?? 'FIRST_OUTREACH'))}
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Available building blocks</SectionTitle>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agents</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.palette.agents.map((agent) => (
                  <Badge key={agent.key} tone={agent.enabled ? 'brand' : 'neutral'}>
                    {agent.name}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Condition fields</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.palette.conditionFields.map((field) => (
                  <Badge key={field} tone="purple">
                    {field}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.palette.actions.map((action) => (
                  <Badge key={action} tone="success">
                    {action.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <NodeEditor
        node={editingNode}
        palette={data.palette}
        onClose={() => setEditingNode(null)}
        onSave={updateNode}
      />
    </div>
  );
}

function NodeConfigSummary({ node }: { node: WorkflowNode }) {
  const config = node.config ?? {};
  if (node.type === 'condition') {
    return (
      <p className="mt-2 font-mono text-xs text-violet-700 dark:text-violet-300">
        {String(config.field)} {String(config.operator)} {String(config.value)}
      </p>
    );
  }
  if (node.type === 'agent' && Array.isArray(config.channels)) {
    return (
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Channels: {(config.channels as string[]).join(', ')}
      </p>
    );
  }
  if (node.type === 'agent' && config.limit) {
    return <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Up to {String(config.limit)} businesses</p>;
  }
  if (node.type === 'approval') {
    return (
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        Opens a {titleCase(String(config.kind ?? 'FIRST_OUTREACH'))} gate
      </p>
    );
  }
  return null;
}

function NodeEditor({
  node,
  palette,
  onClose,
  onSave,
}: {
  node: WorkflowNode | null;
  palette: WorkflowsResponse['palette'];
  onClose: () => void;
  onSave: (node: WorkflowNode) => void;
}) {
  const [form, setForm] = useState<WorkflowNode | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  if (node && loaded !== node.id) {
    setLoaded(node.id);
    setForm(JSON.parse(JSON.stringify(node)) as WorkflowNode);
  }

  if (!node || !form) return <Modal open={false} onClose={onClose} title="" children={null} />;

  const config = form.config ?? {};
  const setConfig = (key: string, value: unknown) =>
    setForm({ ...form, config: { ...config, [key]: value } });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit “${node.label}”`}
      description={`${titleCase(node.type)} node`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => onSave(form)}>
            Apply
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Label">
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea
            className="input min-h-[80px]"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        {form.type === 'agent' && (
          <Field label="Agent">
            <select
              className="input"
              value={form.agent ?? ''}
              onChange={(e) => setForm({ ...form, agent: e.target.value })}
            >
              {palette.agents.map((agent) => (
                <option key={agent.key} value={agent.key}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {form.type === 'agent' && form.agent === 'market_scout' && (
          <Field label="Businesses per run">
            <input
              className="input"
              type="number"
              min={1}
              max={40}
              value={Number(config.limit ?? 12)}
              onChange={(e) => setConfig('limit', Number(e.target.value))}
            />
          </Field>
        )}

        {form.type === 'agent' && form.agent === 'outreach_agent' && (
          <Field label="Channels" hint="Comma-separated: email, whatsapp, sms, linkedin.">
            <input
              className="input"
              value={(Array.isArray(config.channels) ? (config.channels as string[]) : []).join(', ')}
              onChange={(e) =>
                setConfig(
                  'channels',
                  e.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
        )}

        {form.type === 'condition' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Field">
              <select
                className="input"
                value={String(config.field ?? 'leadScore')}
                onChange={(e) => setConfig('field', e.target.value)}
              >
                {palette.conditionFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Operator">
              <select
                className="input"
                value={String(config.operator ?? '>=')}
                onChange={(e) => setConfig('operator', e.target.value)}
              >
                {['>=', '>', '<=', '<', '==', '!=', 'exists'].map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Value">
              <input
                className="input"
                value={String(config.value ?? '')}
                onChange={(e) => {
                  const raw = e.target.value;
                  const numeric = Number(raw);
                  setConfig('value', raw !== '' && Number.isFinite(numeric) ? numeric : raw);
                }}
              />
            </Field>
          </div>
        )}

        {form.type === 'approval' && (
          <Field label="Approval kind">
            <select
              className="input"
              value={String(config.kind ?? 'FIRST_OUTREACH')}
              onChange={(e) => setConfig('kind', e.target.value)}
            >
              {palette.approvalKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {titleCase(kind)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {form.type === 'action' && (
          <Field label="Action">
            <select
              className="input"
              value={String(config.action ?? 'notify')}
              onChange={(e) => setConfig('action', e.target.value)}
            >
              {palette.actions.map((action) => (
                <option key={action} value={action}>
                  {action.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
