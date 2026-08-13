import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Target } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { compactCurrency, percent } from '../lib/format';
import {
  Badge,
  Card,
  DemoBadge,
  EmptyState,
  ErrorBlock,
  GradeBadge,
  LoadingBlock,
  PageHeader,
  ScoreBar,
  SectionTitle,
  Spinner,
} from '../components/ui';
import type { Lead } from '../lib/types';

interface LeadsResponse {
  items: Lead[];
  total: number;
}

/**
 * Opportunities is the "why" view: leads ranked by opportunity score with the
 * evidence that produced it, so an operator can sanity-check the reasoning
 * before anything is sent.
 */
export function OpportunitiesPage() {
  const [minScore, setMinScore] = useState(60);
  const { can } = useAuth();
  const { run, pending } = useAction();
  const { data, loading, error, refetch } = useQuery<LeadsResponse>(
    `/leads?minScore=${minScore}&sort=score&limit=60`,
    [minScore],
  );

  const draft = (leadId: string) =>
    run(() => api(`/leads/${leadId}/draft-outreach`, { method: 'POST', body: {} }), {
      success: 'Drafts generated and queued for approval',
      onSuccess: refetch,
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunities"
        description="Every lead the analyst believes has a real, evidenced digital gap — ranked, with the reasoning attached."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Minimum score</label>
            <select className="input w-auto" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
              {[40, 50, 60, 70, 80].map((value) => (
                <option key={value} value={value}>
                  {value}+
                </option>
              ))}
            </select>
          </div>
        }
      />

      {loading && <LoadingBlock label="Ranking opportunities" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title="No opportunities at this threshold"
          description="Lower the minimum score, or run market research to find more businesses."
          action={
            <Link to="/research" className="btn-primary">
              Run market research
            </Link>
          }
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {data?.items.map((lead) => (
          <Card key={lead.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/leads/${lead.id}`}
                    className="truncate text-base font-semibold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                  >
                    {lead.businessName}
                  </Link>
                  {lead.isDemo && <DemoBadge />}
                  <GradeBadge grade={lead.leadGrade} />
                </div>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {lead.category} · {lead.city}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {lead.opportunityScore ?? '—'}
                </p>
                <p className="text-xs text-slate-500">opportunity</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {lead.problem && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Problem</p>
                  <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{lead.problem}</p>
                </div>
              )}
              {lead.recommendedServiceLabel && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <Badge tone="brand">{lead.recommendedServiceLabel}</Badge>
                    <span className="tabular-nums">{compactCurrency(lead.estimatedValue)} est.</span>
                    <span className="text-slate-400">·</span>
                    <span>confidence {percent((lead.confidence ?? 0) * 100)}</span>
                  </p>
                </div>
              )}
              {lead.signals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
                  <ul className="mt-1 space-y-1">
                    {lead.signals.slice(0, 3).map((signal) => (
                      <li key={signal.key} className="text-sm text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{signal.label}:</span>{' '}
                        {signal.evidence}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
              <ScoreBar value={lead.leadScore} label="lead score" />
              {can('analyst') && (
                <button type="button" className="btn-secondary" onClick={() => draft(lead.id)} disabled={pending}>
                  {pending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                  Draft outreach
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {data && data.items.length > 0 && (
        <Card>
          <SectionTitle>How the score is built</SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The opportunity score is computed deterministically from observed signals (62% of the weight), customer
            demand (25%) and business quality (13%). A missing observation is treated as unknown, never as a
            deficiency — which is why sparse listings score lower and carry a low-confidence caveat rather than an
            invented gap.
          </p>
        </Card>
      )}
    </div>
  );
}
