import { useState } from 'react';
import { Bot, RotateCcw, Save, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { relativeTime } from '../lib/format';
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
  Toggle,
} from '../components/ui';
import type { AgentConfig, ToolDescriptor } from '../lib/types';

interface AgentsResponse {
  items: AgentConfig[];
  tools: ToolDescriptor[];
}

/**
 * Agent Control Center — the configuration surface for every agent: identity,
 * system instructions, tools, allowed actions, approval requirements and the
 * limits the orchestrator enforces (max actions, retry limit).
 */
export function AgentsPage() {
  const { can } = useAuth();
  const { data, loading, error, refetch } = useQuery<AgentsResponse>('/agents');
  const [editing, setEditing] = useState<AgentConfig | null>(null);

  if (loading) return <LoadingBlock label="Loading agents" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Configure each specialist agent: what it is for, how it is instructed, which tools it may use and when it must stop for a human."
      />

      {!can('admin') && (
        <InfoNote>Agent configuration is admin-only. You can review every setting here in read-only mode.</InfoNote>
      )}

      <Card>
        <SectionTitle hint="Live capability of the tool layer">Tools</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.tools.map((tool) => (
            <div key={tool.key} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                  <Wrench className="h-3.5 w-3.5 text-slate-400" />
                  {tool.name}
                </span>
                <Badge tone={tool.available ? 'success' : tool.hasDemoFallback ? 'warning' : 'neutral'}>
                  {tool.available ? 'live' : tool.hasDemoFallback ? 'demo fallback' : 'not connected'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tool.description}</p>
              {tool.requires && (
                <p className="mt-1 text-xs text-slate-400">Requires the {tool.requires.replace(/_/g, ' ')} integration</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {data.items.map((agent) => (
          <Card key={agent.key} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    <Bot className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">{agent.name}</h3>
                  {agent.isCore && <Badge tone="brand">core</Badge>}
                  <Badge tone={agent.enabled ? 'success' : 'neutral'}>{agent.enabled ? 'enabled' : 'disabled'}</Badge>
                  {agent.requiresApproval && <Badge tone="warning">approval required</Badge>}
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{agent.role}</p>
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{agent.description}</p>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                { label: 'Max actions', value: agent.maxActions },
                { label: 'Retry limit', value: agent.retryLimit },
                { label: 'Output', value: agent.outputFormat },
                { label: 'Tools', value: agent.tools.length },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-white/[0.04]">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">{item.label}</dt>
                  <dd className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{item.value}</dd>
                </div>
              ))}
            </dl>

            {agent.allowedActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {agent.allowedActions.map((action) => (
                  <Badge key={action} tone="neutral">
                    {action.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            )}

            <details className="mt-4 group">
              <summary className="cursor-pointer text-sm font-medium text-brand-600 dark:text-brand-400">
                System instructions
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-400">
                {agent.systemPrompt}
              </pre>
            </details>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
              <span className="text-xs text-slate-400">Updated {relativeTime(agent.updatedAt)}</span>
              {can('admin') && (
                <button type="button" className="btn-secondary" onClick={() => setEditing(agent)}>
                  Configure
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <AgentEditor
        agent={editing}
        tools={data.tools}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
        }}
      />
    </div>
  );
}

function AgentEditor({
  agent,
  tools,
  onClose,
  onSaved,
}: {
  agent: AgentConfig | null;
  tools: ToolDescriptor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run, pending } = useAction();
  const [form, setForm] = useState<AgentConfig | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  if (agent && loaded !== agent.key) {
    setLoaded(agent.key);
    setForm({ ...agent });
  }

  if (!agent || !form) {
    return <Modal open={false} onClose={onClose} title="" children={null} />;
  }

  const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const toggleTool = (key: string) =>
    update(
      'tools',
      form.tools.includes(key) ? form.tools.filter((t) => t !== key) : [...form.tools, key],
    );

  const save = async () => {
    const result = await run(
      () =>
        api(`/agents/${agent.key}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            role: form.role,
            description: form.description,
            systemPrompt: form.systemPrompt,
            tools: form.tools,
            allowedActions: form.allowedActions,
            requiresApproval: form.requiresApproval,
            maxActions: form.maxActions,
            retryLimit: form.retryLimit,
            outputFormat: form.outputFormat,
            enabled: form.enabled,
          },
        }),
      { success: `${form.name} updated` },
    );
    if (result) onSaved();
  };

  const reset = async () => {
    const result = await run(() => api(`/agents/${agent.key}/reset`, { method: 'POST', body: {} }), {
      success: `${agent.name} restored to shipped defaults`,
    });
    if (result) onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Configure ${agent.name}`}
      description="Changes take effect on the next run. The orchestrator enforces these limits."
      wide
      footer={
        <>
          <button type="button" className="btn-ghost mr-auto" onClick={reset} disabled={pending}>
            <RotateCcw className="h-4 w-4" />
            Reset to defaults
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending ? <Spinner /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agent name">
            <input className="input" value={form.name} onChange={(e) => update('name', e.target.value)} />
          </Field>
          <Field label="Output format">
            <select
              className="input"
              value={form.outputFormat}
              onChange={(e) => update('outputFormat', e.target.value)}
            >
              <option value="json">JSON</option>
              <option value="text">Text</option>
              <option value="markdown">Markdown</option>
            </select>
          </Field>
        </div>

        <Field label="Role" hint="One sentence describing what this agent is responsible for.">
          <input className="input" value={form.role} onChange={(e) => update('role', e.target.value)} />
        </Field>

        <Field
          label="System instructions"
          hint="The hard rules at the top of the shipped prompt (no fabrication, no prices, no human impersonation) are what keep the agent safe — keep them."
        >
          <textarea
            className="input min-h-[220px] font-mono text-xs leading-relaxed"
            value={form.systemPrompt}
            onChange={(e) => update('systemPrompt', e.target.value)}
          />
        </Field>

        <div>
          <p className="label">Enabled tools</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {tools.map((tool) => (
              <label
                key={tool.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-2.5 dark:border-white/10"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={form.tools.includes(tool.key)}
                  onChange={() => toggleTool(tool.key)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{tool.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {tool.available ? 'Connected' : tool.hasDemoFallback ? 'Falls back to demo data' : 'Not connected'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Field label="Allowed actions" hint="Comma-separated. The orchestrator will not ask this agent to do anything outside this list.">
          <input
            className="input"
            value={form.allowedActions.join(', ')}
            onChange={(e) =>
              update(
                'allowedActions',
                e.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximum actions per run">
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              value={form.maxActions}
              onChange={(e) => update('maxActions', Number(e.target.value))}
            />
          </Field>
          <Field label="Retry limit" hint="How many times a failed self-verification is retried.">
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              value={form.retryLimit}
              onChange={(e) => update('retryLimit', Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-white/10">
          <Toggle
            checked={form.enabled}
            onChange={(value) => update('enabled', value)}
            label="Agent enabled"
            description="A disabled agent is skipped; the pipeline falls back to the deterministic rule engine where it can."
          />
          <Toggle
            checked={form.requiresApproval}
            onChange={(value) => update('requiresApproval', value)}
            label="Output requires human approval"
            description="Anything this agent produces that reaches the outside world goes through an approval gate."
          />
        </div>
      </div>
    </Modal>
  );
}
