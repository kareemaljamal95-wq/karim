import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowRight,
  CheckSquare,
  CircleDollarSign,
  MessageSquare,
  Radar,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { useChartTheme, tooltipStyles } from '../lib/charts';
import { compactCurrency, number, relativeTime } from '../lib/format';
import { StatTile } from '../components/StatTile';
import {
  Card,
  DemoBadge,
  EmptyState,
  ErrorBlock,
  GradeBadge,
  InfoNote,
  LoadingBlock,
  PageHeader,
  ScoreBar,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import type { ActivityLog, Approval, Lead, Message, OverviewMetrics, Run, SystemStatus } from '../lib/types';

interface OverviewResponse {
  metrics: OverviewMetrics;
  status: SystemStatus;
  pendingApprovals: Approval[];
  recentLeads: Lead[];
  recentRuns: Run[];
  recentActivity: ActivityLog[];
  draftMessages: Message[];
}

export function OverviewPage() {
  const { data, loading, error, refetch } = useQuery<OverviewResponse>('/system/overview');
  const theme = useChartTheme();

  if (loading) return <LoadingBlock label="Loading your command centre" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  const { metrics, status, pendingApprovals, recentLeads, recentRuns, recentActivity } = data;

  const funnel = [
    { stage: 'Leads', count: metrics.totalLeads },
    { stage: 'Qualified', count: metrics.qualifiedLeads },
    { stage: 'Messages sent', count: metrics.messagesSent },
    { stage: 'Replies', count: metrics.replies },
    { stage: 'Interested', count: metrics.interestedLeads },
    { stage: 'Won', count: metrics.wonDeals },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="What the AI CEO has found, what it is holding, and what needs you."
        actions={
          <Link to="/research" className="btn-primary">
            <Radar className="h-4 w-4" />
            Run market research
          </Link>
        }
      />

      {status.launchBlockers.length > 0 && (
        <InfoNote tone="warning">
          <strong>Before outreach can reach anyone ({status.launchBlockers.length}):</strong>
          <ul className="mt-2 space-y-1.5">
            {status.launchBlockers.map((blocker) => (
              <li key={blocker.key}>
                <span className="font-medium">{blocker.title}.</span>{' '}
                <span className="text-slate-600 dark:text-slate-400">{blocker.detail}</span>
              </li>
            ))}
          </ul>
        </InfoNote>
      )}

      {status.demoMode && (
        <InfoNote tone="warning">
          <strong>Demo mode.</strong> Google Places is not connected, so discovery returns clearly-labelled
          sample businesses. {number(metrics.demoLeads)} of {number(metrics.totalLeads)} leads are demo
          records. Connect the integration in{' '}
          <Link to="/integrations" className="font-medium underline">
            Integrations
          </Link>{' '}
          to discover real businesses.
        </InfoNote>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Total leads" value={number(metrics.totalLeads)} icon={<Users className="h-4 w-4" />} to="/leads" />
        <StatTile
          label="Qualified"
          value={number(metrics.qualifiedLeads)}
          tone="brand"
          icon={<Target className="h-4 w-4" />}
          hint={`${metrics.gradeCounts.A} grade A`}
          to="/leads?grade=A"
        />
        <StatTile
          label="High opportunity"
          value={number(metrics.highOpportunityLeads)}
          tone="success"
          icon={<TrendingUp className="h-4 w-4" />}
          hint="Opportunity score ≥ 70"
          to="/opportunities"
        />
        <StatTile
          label="Pending approvals"
          value={number(metrics.pendingApprovals)}
          tone={metrics.pendingApprovals > 0 ? 'warning' : 'neutral'}
          icon={<CheckSquare className="h-4 w-4" />}
          hint="Nothing is sent without you"
          to="/approvals"
        />
        <StatTile
          label="Pipeline value"
          value={compactCurrency(metrics.estimatedPipelineValue)}
          tone="brand"
          icon={<CircleDollarSign className="h-4 w-4" />}
          hint="Estimated, open leads only"
          to="/analytics"
        />
        <StatTile label="Messages drafted" value={number(metrics.messagesDrafted)} icon={<MessageSquare className="h-4 w-4" />} to="/messages" />
        <StatTile label="Messages sent" value={number(metrics.messagesSent)} to="/messages?status=SENT" />
        <StatTile label="Replies" value={number(metrics.replies)} to="/messages" />
        <StatTile label="Interested" value={number(metrics.interestedLeads)} tone="success" to="/leads?status=INTERESTED" />
        <StatTile label="Won deals" value={number(metrics.wonDeals)} tone="success" to="/leads?status=WON" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle hint="Counts, not rates">Pipeline funnel</SectionTitle>
          {metrics.totalLeads === 0 ? (
            <EmptyState
              title="No leads yet"
              description="Run market research to discover businesses and build the pipeline."
              action={
                <Link to="/research" className="btn-primary">
                  Run market research
                </Link>
              }
            />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke={theme.grid} />
                  <XAxis type="number" stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={110}
                    stroke={theme.axis}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...tooltipStyles(theme)} />
                  <Bar dataKey="count" name="Leads" fill={theme.series[0]} radius={[0, 4, 4, 0]} barSize={18}>
                    <LabelList dataKey="count" position="right" className="fill-slate-500 text-xs" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle hint={`${pendingApprovals.length} waiting`}>Needs your decision</SectionTitle>
          {pendingApprovals.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Every approval gate is clear." />
          ) : (
            <ul className="space-y-3">
              {pendingApprovals.map((approval) => (
                <li key={approval.id}>
                  <Link
                    to="/approvals"
                    className="block rounded-xl border border-slate-200 p-3 transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{approval.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">{relativeTime(approval.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{approval.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle hint="Newest first">Recent leads</SectionTitle>
          {recentLeads.length === 0 ? (
            <EmptyState title="No leads yet" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link to={`/leads/${lead.id}`} className="flex items-center gap-4 py-3 row-hover -mx-2 rounded-lg px-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {lead.businessName}
                        </p>
                        {lead.isDemo && <DemoBadge />}
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {lead.category} · {lead.city}
                        {lead.recommendedServiceLabel ? ` · ${lead.recommendedServiceLabel}` : ''}
                      </p>
                    </div>
                    <ScoreBar value={lead.leadScore} />
                    <GradeBadge grade={lead.leadGrade} />
                    <StatusBadge status={lead.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/leads" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
            All leads <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Card>

        <Card>
          <SectionTitle>Agent activity</SectionTitle>
          {recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" icon={<Activity className="h-5 w-5" />} />
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-4 dark:border-white/10">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                      entry.level === 'error'
                        ? 'bg-rose-500'
                        : entry.level === 'warn'
                          ? 'bg-amber-500'
                          : entry.actorType === 'agent'
                            ? 'bg-brand-500'
                            : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                  <p className="text-sm text-slate-700 dark:text-slate-200">{entry.message}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {entry.actor} · {relativeTime(entry.ts)}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <Link to="/logs" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
            Full activity log <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Card>
      </div>

      {recentRuns.length > 0 && (
        <Card>
          <SectionTitle hint="Most recent orchestrator runs">Workflow runs</SectionTitle>
          <ul className="space-y-2">
            {recentRuns.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-white/10"
              >
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{run.goal}</span>
                {run.demo && <DemoBadge />}
                <StatusBadge status={run.status} />
                <span className="text-xs text-slate-400">
                  {run.steps.filter((s) => s.status === 'COMPLETED').length}/{run.steps.length} steps ·{' '}
                  {relativeTime(run.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
