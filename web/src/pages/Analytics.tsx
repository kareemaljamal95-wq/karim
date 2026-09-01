import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { tooltipStyles, useChartTheme } from '../lib/charts';
import { compactCurrency, dateOnly, number, percent } from '../lib/format';
import { StatTile } from '../components/StatTile';
import {
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  TableWrap,
  Td,
  Th,
} from '../components/ui';
import type { OverviewMetrics } from '../lib/types';

interface AnalyticsResponse {
  metrics: OverviewMetrics;
  funnel: { stage: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byGrade: { grade: string; count: number; value: number }[];
  byService: { service: string; label: string; count: number; value: number }[];
  byCity: { city: string; count: number; avgScore: number }[];
  byCategory: { category: string; count: number; avgScore: number }[];
  scoreDistribution: { bucket: string; count: number }[];
  activityByDay: { date: string; leads: number; messages: number; approvals: number }[];
  conversion: { contactedToReplied: number; repliedToInterested: number; interestedToWon: number };
  dataQuality: { withEmail: number; withPhone: number; withWebsite: number; withoutContact: number; total: number };
}

export function AnalyticsPage() {
  const { data, loading, error, refetch } = useQuery<AnalyticsResponse>('/system/analytics');
  const theme = useChartTheme();
  const tip = tooltipStyles(theme);

  if (loading) return <LoadingBlock label="Crunching the numbers" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  if (data.metrics.totalLeads === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description="Pipeline performance across the whole platform." />
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No data to chart yet"
          description="Run market research to build a pipeline, then come back."
        />
      </div>
    );
  }

  const activity = data.activityByDay.map((day) => ({ ...day, label: dateOnly(day.date) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Pipeline performance across the whole platform." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Pipeline value"
          value={compactCurrency(data.metrics.estimatedPipelineValue)}
          hint="Estimated, open leads only"
          tone="brand"
        />
        <StatTile
          label="Contacted → replied"
          value={percent(data.conversion.contactedToReplied)}
          hint="Reply rate on contacted leads"
        />
        <StatTile
          label="Replied → interested"
          value={percent(data.conversion.repliedToInterested)}
          tone="success"
        />
        <StatTile label="Interested → won" value={percent(data.conversion.interestedToWon)} tone="success" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle hint="Lead counts at each stage">Pipeline funnel</SectionTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funnel} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }}>
                <CartesianGrid horizontal={false} stroke={theme.grid} />
                <XAxis type="number" stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="stage"
                  width={140}
                  stroke={theme.axis}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip {...tip} />
                <Bar dataKey="count" name="Leads" fill={theme.series[0]} radius={[0, 4, 4, 0]} barSize={16}>
                  <LabelList dataKey="count" position="right" className="fill-slate-500 text-xs" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionTitle hint="A is the strongest tier">Lead grade mix</SectionTitle>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byGrade} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis dataKey="grade" stroke={theme.axis} tickLine={false} axisLine={false} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tip} />
                <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]} barSize={48}>
                  {/* Ordinal ramp: darker = higher tier. */}
                  {data.byGrade.map((entry, index) => (
                    <Cell key={entry.grade} fill={theme.ordinal[Math.min(index, theme.ordinal.length - 1)]} />
                  ))}
                  <LabelList dataKey="count" position="top" className="fill-slate-500 text-xs" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle hint="Last 14 days">Platform activity</SectionTitle>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activity} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="label" stroke={theme.axis} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tip} />
              <Legend
                verticalAlign="top"
                align="left"
                height={32}
                iconType="plainline"
                wrapperStyle={{ fontSize: 12, color: theme.muted }}
              />
              <Line
                type="monotone"
                dataKey="leads"
                name="Leads discovered"
                stroke={theme.series[0]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="messages"
                name="Messages drafted"
                stroke={theme.series[1]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="approvals"
                name="Approvals opened"
                stroke={theme.series[2]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle hint="Where the evidence points">Recommended services</SectionTitle>
          {data.byService.length === 0 ? (
            <EmptyState title="No services recommended yet" />
          ) : (
            <div style={{ height: Math.max(220, data.byService.length * 38) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.byService}
                  layout="vertical"
                  margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
                >
                  <CartesianGrid horizontal={false} stroke={theme.grid} />
                  <XAxis type="number" stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={170}
                    stroke={theme.axis}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...tip} />
                  <Bar dataKey="count" name="Leads" fill={theme.series[0]} radius={[0, 4, 4, 0]} barSize={14}>
                    <LabelList dataKey="count" position="right" className="fill-slate-500 text-xs" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle hint="Lead score, 0-100">Score distribution</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.scoreDistribution} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis dataKey="bucket" stroke={theme.axis} tickLine={false} axisLine={false} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tip} />
                <Bar dataKey="count" name="Leads" fill={theme.series[0]} radius={[4, 4, 0, 0]} barSize={38}>
                  <LabelList dataKey="count" position="top" className="fill-slate-500 text-xs" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-2">
            <SectionTitle hint="Average opportunity score">By city</SectionTitle>
          </div>
          <TableWrap>
            <thead>
              <tr>
                <Th>City</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Avg. opportunity</Th>
              </tr>
            </thead>
            <tbody>
              {data.byCity.map((row) => (
                <tr key={row.city} className="row-hover">
                  <Td className="font-medium text-slate-800 dark:text-slate-100">{row.city}</Td>
                  <Td className="text-right tabular-nums">{number(row.count)}</Td>
                  <Td className="text-right tabular-nums">{row.avgScore}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-2">
            <SectionTitle hint="Average opportunity score">By category</SectionTitle>
          </div>
          <TableWrap>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Avg. opportunity</Th>
              </tr>
            </thead>
            <tbody>
              {data.byCategory.map((row) => (
                <tr key={row.category} className="row-hover">
                  <Td className="font-medium text-slate-800 dark:text-slate-100">{row.category}</Td>
                  <Td className="text-right tabular-nums">{number(row.count)}</Td>
                  <Td className="text-right tabular-nums">{row.avgScore}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      <Card>
        <SectionTitle hint="How reachable the database actually is">Contact data quality</SectionTitle>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="With email"
            value={`${data.dataQuality.withEmail} / ${data.dataQuality.total}`}
            hint={percent((data.dataQuality.withEmail / Math.max(1, data.dataQuality.total)) * 100)}
          />
          <StatTile
            label="With phone"
            value={`${data.dataQuality.withPhone} / ${data.dataQuality.total}`}
            hint={percent((data.dataQuality.withPhone / Math.max(1, data.dataQuality.total)) * 100)}
          />
          <StatTile label="With website" value={`${data.dataQuality.withWebsite} / ${data.dataQuality.total}`} />
          <StatTile
            label="No contact channel"
            value={data.dataQuality.withoutContact}
            tone={data.dataQuality.withoutContact > 0 ? 'warning' : 'neutral'}
            hint="Cannot be contacted — never invented"
          />
        </div>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Leads without a published contact channel are capped out of grade A rather than being given a guessed
          address. Google Places does not expose email addresses, so live leads often need enrichment before
          outreach.
        </p>
      </Card>
    </div>
  );
}
