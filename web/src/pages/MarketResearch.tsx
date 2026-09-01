import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, CircleSlash, Clock, Radar, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery, useSystemStatus } from '../lib/hooks';
import { relativeTime } from '../lib/format';
import {
  Badge,
  Card,
  DemoBadge,
  EmptyState,
  Field,
  GradeBadge,
  InfoNote,
  PageHeader,
  ScoreBar,
  SectionTitle,
  Spinner,
  StatusBadge,
  TableWrap,
  Td,
  Th,
} from '../components/ui';
import type { DiscoveryRunSummary, Run } from '../lib/types';

interface OptionsResponse {
  categories: string[];
  locations: { country: string; city: string }[];
  defaults: { country: string; city: string };
  liveDiscovery: boolean;
  demoNotice: string | null;
}

interface ResearchRun {
  id: string;
  country: string;
  city: string;
  area: string;
  category: string;
  source: string;
  demo: boolean;
  discovered: number;
  imported: number;
  duplicates: number;
  createdAt: string;
}

export function MarketResearchPage() {
  const { can } = useAuth();
  const { refresh } = useSystemStatus();
  const { run, pending } = useAction();
  const { data: options } = useQuery<OptionsResponse>('/research/options');
  const { data: history, refetch: refetchHistory } = useQuery<{ items: ResearchRun[] }>('/research/runs');
  const { data: executions, refetch: refetchExecutions } = useQuery<{ items: Run[] }>('/research/executions');

  const [form, setForm] = useState({
    country: '',
    city: '',
    area: '',
    category: 'Restaurants',
    limit: 10,
    draftOutreach: true,
    contactableOnly: true,
  });
  const [summary, setSummary] = useState<DiscoveryRunSummary | null>(null);

  useEffect(() => {
    if (options && !form.country) {
      setForm((current) => ({
        ...current,
        country: options.defaults.country,
        city: options.defaults.city,
      }));
    }
  }, [options, form.country]);

  const start = async () => {
    const result = await run<DiscoveryRunSummary>(
      () =>
        api('/research/run', {
          method: 'POST',
          body: {
            country: form.country,
            city: form.city,
            area: form.area || undefined,
            category: form.category,
            limit: Number(form.limit),
            draftOutreach: form.draftOutreach,
            contactableOnly: form.contactableOnly,
          },
        }),
      { success: 'Research run finished' },
    );
    if (result) {
      setSummary(result);
      refetchHistory();
      refetchExecutions();
      refresh();
    }
  };

  const latestRun = executions?.items[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Research"
        description="Point the Market Scout at a country, city, area and category. The orchestrator runs the whole pipeline and stops at the approval gate."
      />

      {options && !options.liveDiscovery && (
        <InfoNote tone="warning">
          <strong>Demo mode.</strong> {options.demoNotice} Results are fictional samples, flagged as demo
          everywhere in the platform.
        </InfoNote>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <SectionTitle>New research run</SectionTitle>
          <div className="space-y-4">
            <Field label="Country">
              <input
                className="input"
                list="countries"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
              <datalist id="countries">
                {[...new Set(options?.locations.map((l) => l.country) ?? [])].map((country) => (
                  <option key={country} value={country} />
                ))}
              </datalist>
            </Field>
            <Field label="City">
              <input
                className="input"
                list="cities"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <datalist id="cities">
                {[...new Set(options?.locations.map((l) => l.city) ?? [])].map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </Field>
            <Field label="Area" hint="Optional — narrows the search to a district.">
              <input className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </Field>
            <Field label="Business category">
              <input
                className="input"
                list="categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
              <datalist id="categories">
                {(options?.categories ?? []).map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
            <Field label="How many businesses">
              <input
                className="input"
                type="number"
                min={1}
                max={40}
                value={form.limit}
                onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })}
              />
            </Field>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.contactableOnly}
                onChange={(e) => setForm({ ...form, contactableOnly: e.target.checked })}
              />
              <span className="text-slate-700 dark:text-slate-300">
                Only businesses you can contact
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  Off, a short batch is topped up with businesses that publish no website, phone or
                  email — worth recording, but nobody you can approach today.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.draftOutreach}
                onChange={(e) => setForm({ ...form, draftOutreach: e.target.checked })}
              />
              <span className="text-slate-700 dark:text-slate-300">
                Draft outreach for qualified leads
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  Drafts go to the approval queue. Nothing is ever sent by this run.
                </span>
              </span>
            </label>

            <button
              type="button"
              className="btn-primary w-full"
              onClick={start}
              disabled={pending || !can('analyst') || !form.country || !form.city || !form.category}
            >
              {pending ? <Spinner /> : <Radar className="h-4 w-4" />}
              {pending ? 'Running the pipeline…' : 'Start research run'}
            </button>
            {!can('analyst') && (
              <p className="text-xs text-slate-500">Your role can view research but not start new runs.</p>
            )}
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {summary && <RunSummaryCard summary={summary} />}
          {latestRun && <RunTimeline run={latestRun} />}
          {!summary && !latestRun && (
            <Card>
              <EmptyState
                icon={<Radar className="h-6 w-6" />}
                title="No research runs yet"
                description="Choose a city and category on the left to discover businesses and build your pipeline."
              />
            </Card>
          )}
        </div>
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <SectionTitle hint={`${history?.items.length ?? 0} runs`}>Research history</SectionTitle>
        </div>
        {history && history.items.length > 0 ? (
          <TableWrap>
            <thead>
              <tr>
                <Th>Search</Th>
                <Th>Source</Th>
                <Th className="text-right">Discovered</Th>
                <Th className="text-right">Imported</Th>
                <Th className="text-right">Duplicates</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((entry) => (
                <tr key={entry.id} className="row-hover">
                  <Td>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{entry.category}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {' '}
                      in {[entry.area, entry.city, entry.country].filter(Boolean).join(', ')}
                    </span>
                  </Td>
                  <Td>{entry.demo ? <DemoBadge /> : <Badge tone="success">live</Badge>}</Td>
                  <Td className="text-right tabular-nums">{entry.discovered}</Td>
                  <Td className="text-right tabular-nums">{entry.imported}</Td>
                  <Td className="text-right tabular-nums">{entry.duplicates}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{relativeTime(entry.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-5">
            <EmptyState title="No history yet" />
          </div>
        )}
      </Card>
    </div>
  );
}

function RunSummaryCard({ summary }: { summary: DiscoveryRunSummary }) {
  return (
    <Card>
      <SectionTitle hint={summary.query}>Run result</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Discovered', value: summary.discovered },
          { label: 'Imported', value: summary.imported },
          { label: 'Duplicates', value: summary.duplicates },
          { label: 'Qualified', value: summary.qualified },
          { label: 'Drafts', value: summary.messagesDrafted },
          { label: 'Approvals', value: summary.approvalsCreated },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]">
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {summary.notice && (
        <div className="mt-4">
          <InfoNote tone="warning">{summary.notice}</InfoNote>
        </div>
      )}
      {summary.warnings.length > 0 && (
        <div className="mt-3">
          <InfoNote>
            <p className="font-medium">The orchestrator flagged {summary.warnings.length} item(s):</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {summary.warnings.slice(0, 6).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </InfoNote>
        </div>
      )}

      {summary.leads.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Leads from this run</p>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {summary.leads.slice(0, 10).map((lead) => (
              <li key={lead.id}>
                <Link to={`/leads/${lead.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 row-hover">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                    {lead.businessName}
                  </span>
                  <ScoreBar value={lead.leadScore} />
                  <GradeBadge grade={lead.leadGrade} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const STEP_ICONS: Record<string, typeof CheckCircle2> = {
  COMPLETED: CheckCircle2,
  RUNNING: CircleDashed,
  WAITING_APPROVAL: Clock,
  FAILED: XCircle,
  SKIPPED: CircleSlash,
  PENDING: CircleDashed,
};

const STEP_TONES: Record<string, string> = {
  COMPLETED: 'text-emerald-500',
  RUNNING: 'text-brand-500',
  WAITING_APPROVAL: 'text-amber-500',
  FAILED: 'text-rose-500',
  SKIPPED: 'text-slate-400',
  PENDING: 'text-slate-400',
};

/** Step-by-step trace of what the orchestrator did, including self-verification. */
export function RunTimeline({ run }: { run: Run }) {
  return (
    <Card>
      <SectionTitle hint={`${run.status.toLowerCase().replace(/_/g, ' ')} · ${relativeTime(run.startedAt)}`}>
        Execution plan
      </SectionTitle>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{run.goal}</p>
      <ol className="space-y-3">
        {run.steps.map((step) => {
          const Icon = STEP_ICONS[step.status] ?? CircleDashed;
          const failedChecks = step.validation?.checks.filter((c) => c.blocking && !c.passed) ?? [];
          return (
            <li key={step.id} className="flex gap-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STEP_TONES[step.status] ?? 'text-slate-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{step.label}</span>
                  {step.agentKey && <Badge tone="brand">{step.agentKey.replace(/_/g, ' ')}</Badge>}
                  <StatusBadge status={step.status} />
                  {step.attempts > 1 && <Badge tone="warning">{step.attempts} attempts</Badge>}
                </div>
                {step.output != null && (
                  <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {JSON.stringify(step.output)}
                  </p>
                )}
                {step.validation && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Self-verification: {step.validation.checks.filter((c) => c.passed).length}/
                    {step.validation.checks.length} checks passed
                    {failedChecks.length > 0 && ` — failed: ${failedChecks.map((c) => c.name).join(', ')}`}
                  </p>
                )}
                {step.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{step.error}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
