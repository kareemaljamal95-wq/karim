import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Search } from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { dateTime, relativeTime } from '../lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '../components/ui';
import type { ActivityLog } from '../lib/types';

interface LogsResponse {
  items: ActivityLog[];
  total: number;
}

const LEVEL_TONES: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

const ACTOR_TONES: Record<string, 'brand' | 'purple' | 'neutral'> = {
  agent: 'brand',
  user: 'purple',
  system: 'neutral',
};

/**
 * The audit trail. Every agent action, approval decision and external side
 * effect is appended here and is never edited or deleted.
 */
export function LogsPage() {
  const [level, setLevel] = useState('');
  const [actorType, setActorType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 60;

  const query = `/system/logs?${new URLSearchParams({
    ...(level ? { level } : {}),
    ...(actorType ? { actorType } : {}),
    ...(search ? { search } : {}),
    limit: String(pageSize),
    offset: String(page * pageSize),
  }).toString()}`;

  const { data, loading, error, refetch } = useQuery<LogsResponse>(query, [level, actorType, search, page]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Logs"
        description="Append-only audit trail of everything the agents and the team have done."
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search message, action or actor…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <select
            className="input"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All levels</option>
            {['info', 'warn', 'error', 'debug'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={actorType}
            onChange={(event) => {
              setActorType(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All actors</option>
            {['agent', 'user', 'system'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading && <LoadingBlock label="Loading activity" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {data && data.items.length === 0 && !loading && (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="No activity matches these filters" />
      )}

      {data && data.items.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Message</Th>
                <Th>Entity</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr
                  key={entry.id}
                  className="row-hover cursor-pointer align-top"
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                >
                  <Td className="whitespace-nowrap">
                    <span className="text-slate-700 dark:text-slate-300">{relativeTime(entry.ts)}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{dateTime(entry.ts)}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={ACTOR_TONES[entry.actorType] ?? 'neutral'}>{entry.actorType}</Badge>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{entry.actor}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={LEVEL_TONES[entry.level] ?? 'neutral'}>{entry.level}</Badge>
                    <span className="mt-1 block font-mono text-xs text-slate-500 dark:text-slate-400">
                      {entry.action}
                    </span>
                  </Td>
                  <Td className="max-w-xl">
                    <p className="text-slate-700 dark:text-slate-300">{entry.message}</p>
                    {expanded === entry.id && Object.keys(entry.meta).length > 0 && (
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-400">
                        {JSON.stringify(entry.meta, null, 2)}
                      </pre>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {entry.entityType === 'lead' && entry.entityId ? (
                      <Link
                        to={`/leads/${entry.entityId}`}
                        className="text-brand-600 hover:underline dark:text-brand-400"
                        onClick={(event) => event.stopPropagation()}
                      >
                        lead
                      </Link>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">{entry.entityType ?? '—'}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>
              {data.total} entries · page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
