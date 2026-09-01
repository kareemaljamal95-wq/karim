import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp, FileStack, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { compactCurrency, relativeTime, titleCase } from '../lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  InfoNote,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  Spinner,
  StatusBadge,
} from '../components/ui';
import type { Project } from '../lib/types';

interface ProjectsResponse {
  items: Project[];
  statuses: string[];
}

const COMMITMENT_STATUSES = ['ACCEPTED', 'IN_DELIVERY', 'DELIVERED'];

/**
 * Projects are the structured output of the Requirement Agent: what the prospect
 * actually asked for, and — just as importantly — everything still unknown. No
 * project is ever accepted by an agent; moving to a commitment status opens its
 * own approval gate.
 */
export function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const { can } = useAuth();
  const { run, pending } = useAction();
  const { data, loading, error, refetch } = useQuery<ProjectsResponse>(
    `/projects${statusFilter ? `?status=${statusFilter}` : ''}`,
    [statusFilter],
  );

  const changeStatus = (project: Project, status: string) =>
    run<{ approvalRequired: boolean; message?: string }>(
      () => api(`/projects/${project.id}`, { method: 'PATCH', body: { status } }),
      {
        onSuccess: (result) => {
          refetch();
          if (result?.approvalRequired) {
            run(async () => result, {
              success: result.message ?? 'An approval was opened for this commitment.',
            });
          } else {
            run(async () => result, { success: `Status set to ${titleCase(status)}` });
          }
        },
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Prospect requests converted into structured project requests, each routed to human review."
        actions={
          <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {(data?.statuses ?? []).map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
      />

      <InfoNote>
        The Requirement Agent records only what the prospect actually said. Anything a delivery team would still
        need is listed as <strong>missing information</strong> rather than assumed — and the agent never accepts a
        project or quotes a price.
      </InfoNote>

      {loading && <LoadingBlock label="Loading projects" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {data && data.items.length === 0 && !loading && (
        <EmptyState
          icon={<FileStack className="h-6 w-6" />}
          title="No project requests yet"
          description="When a prospect replies asking for work, the Requirement Agent turns it into a structured request here."
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {data?.items.map((project) => (
          <Card key={project.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{project.title}</h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  <Link to={`/leads/${project.leadId}`} className="text-brand-600 hover:underline dark:text-brand-400">
                    {project.leadName}
                  </Link>{' '}
                  · {relativeTime(project.createdAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <StatusBadge status={project.status} />
                <p className="mt-1 text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
                  {compactCurrency(project.estimatedValue)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <ListChecks className="h-3.5 w-3.5" />
                  Requirements
                </p>
                {project.requirements.length === 0 ? (
                  <p className="mt-1.5 text-sm text-slate-400">None stated yet.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {project.requirements.map((requirement) => (
                      <li key={requirement} className="text-sm text-slate-700 dark:text-slate-300">
                        • {requirement}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  <CircleHelp className="h-3.5 w-3.5" />
                  Missing information
                </p>
                {project.missingInformation.length === 0 ? (
                  <p className="mt-1.5 text-sm text-slate-400">Nothing outstanding.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {project.missingInformation.map((item) => (
                      <Badge key={item} tone="warning">
                        {item}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Service:</span> {project.service}
            </p>
            {project.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{project.notes}</p>}

            {can('operator') && (
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
                <label className="text-sm text-slate-600 dark:text-slate-400">Move to</label>
                <select
                  className="input w-auto flex-1"
                  value={project.status}
                  onChange={(event) => changeStatus(project, event.target.value)}
                  disabled={pending}
                >
                  {(data?.statuses ?? []).map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, ' ')}
                      {COMMITMENT_STATUSES.includes(status) ? ' (needs approval)' : ''}
                    </option>
                  ))}
                </select>
                {pending && <Spinner />}
              </div>
            )}
          </Card>
        ))}
      </div>

      {data && data.items.length > 0 && (
        <Card>
          <SectionTitle>Why a commitment needs approval</SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Moving a project to {COMMITMENT_STATUSES.join(', ')} is a commercial commitment. Rather than changing
            the status directly, the platform opens an approval so a human signs off — the same gate that guards
            first contact and price agreements.
          </p>
        </Card>
      )}
    </div>
  );
}
