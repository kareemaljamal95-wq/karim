import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Plus, Search, Users, Globe } from 'lucide-react';
import { api, downloadCsv } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { compactCurrency, relativeTime } from '../lib/format';
import {
  Card,
  DemoBadge,
  EmptyState,
  ErrorBlock,
  Field,
  GradeBadge,
  LoadingBlock,
  Modal,
  PageHeader,
  ScoreBar,
  Spinner,
  StatusBadge,
  Td,
  TableWrap,
  Th,
} from '../components/ui';
import type { Lead } from '../lib/types';

interface LeadsResponse {
  items: Lead[];
  total: number;
  filters: { cities: string[]; categories: string[]; services: string[] };
}

const STATUSES = [
  'NEW',
  'RESEARCHING',
  'QUALIFIED',
  'APPROVAL_REQUIRED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NEGOTIATING',
  'WON',
  'LOST',
  'NOT_A_FIT',
];

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const pageSize = 25;

  const query = useMemo(() => {
    const search = new URLSearchParams();
    for (const key of ['status', 'grade', 'city', 'category', 'search', 'sort']) {
      const value = params.get(key);
      if (value) search.set(key, value);
    }
    search.set('limit', String(pageSize));
    search.set('offset', String(page * pageSize));
    return `/leads?${search.toString()}`;
  }, [params, page]);

  const { data, loading, error, refetch } = useQuery<LeadsResponse>(query);
  const { run: runVerify, pending: verifying } = useAction();

  /**
   * Visits the websites of leads with no email on record. Discovery knows a
   * business exists; its own site is usually where the address to write to is
   * published, so this is what turns a list into people who can be approached.
   */
  const verifyWebsites = () =>
    runVerify<{ candidates: number; inspected: number; emailsFound: number; failures: unknown[] }>(
      () => api('/leads/verify-websites', { method: 'POST', body: { missingContactOnly: true, limit: 25 } }),
      {
        onSuccess: (result) => {
          refetch();
          if (result) {
            const note = result.candidates
              ? `Checked ${result.inspected} website(s) — ${result.emailsFound} new email address(es) found`
              : 'No leads with a website are missing an email address.';
            runVerify(async () => result, { success: note });
          }
        },
      },
    );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(0);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="The CRM-style database of every business the platform has discovered, scored and enriched."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => downloadCsv('/leads/export.csv', 'leads.csv')}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            {can('analyst') && (
              <button
                type="button"
                className="btn-secondary"
                onClick={verifyWebsites}
                disabled={verifying}
                title="Visit the websites of leads with no email, and collect the address they publish"
              >
                <Globe className="h-4 w-4" />
                {verifying ? 'Checking…' : 'Find contacts'}
              </button>
            )}
            {can('operator') && (
              <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Add lead
              </button>
            )}
          </>
        }
      />

      <Card padded={false} className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search name, city, email…"
              value={params.get('search') ?? ''}
              onChange={(event) => setFilter('search', event.target.value)}
            />
          </div>
          <select className="input" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select className="input" value={params.get('grade') ?? ''} onChange={(e) => setFilter('grade', e.target.value)}>
            <option value="">All grades</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </select>
          <select className="input" value={params.get('city') ?? ''} onChange={(e) => setFilter('city', e.target.value)}>
            <option value="">All cities</option>
            {data?.filters.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select className="input" value={params.get('sort') ?? 'score'} onChange={(e) => setFilter('sort', e.target.value)}>
            <option value="score">Sort: lead score</option>
            <option value="value">Sort: estimated value</option>
            <option value="created">Sort: newest</option>
            <option value="updated">Sort: recently updated</option>
          </select>
        </div>
      </Card>

      {loading && <LoadingBlock label="Loading leads" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {data && !loading && (
        <>
          {data.items.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No leads match these filters"
              description="Clear the filters, or run market research to discover new businesses."
              action={
                <Link to="/research" className="btn-primary">
                  Run market research
                </Link>
              }
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th>Location</Th>
                  <Th>Opportunity</Th>
                  <Th>Lead score</Th>
                  <Th>Grade</Th>
                  <Th>Recommended service</Th>
                  <Th className="text-right">Est. value</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((lead) => (
                  <tr key={lead.id} className="row-hover">
                    <Td>
                      <Link to={`/leads/${lead.id}`} className="group flex items-center gap-2">
                        <span className="font-medium text-slate-800 group-hover:text-brand-600 dark:text-slate-100 dark:group-hover:text-brand-400">
                          {lead.businessName}
                        </span>
                        {lead.isDemo && <DemoBadge />}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{lead.category}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {lead.city}
                      {lead.area ? ` · ${lead.area}` : ''}
                    </Td>
                    <Td>
                      <ScoreBar value={lead.opportunityScore} />
                    </Td>
                    <Td>
                      <ScoreBar value={lead.leadScore} />
                    </Td>
                    <Td>
                      <GradeBadge grade={lead.leadGrade} />
                    </Td>
                    <Td className="max-w-[220px] truncate text-slate-600 dark:text-slate-300">
                      {lead.recommendedServiceLabel ?? '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {compactCurrency(lead.estimatedValue)}
                    </Td>
                    <Td>
                      <StatusBadge status={lead.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      {relativeTime(lead.updatedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}

          <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>
              {data.total} lead{data.total === 1 ? '' : 's'} · page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <CreateLeadModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={refetch} />
    </div>
  );
}

function CreateLeadModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { run, pending } = useAction();
  const [form, setForm] = useState({
    businessName: '',
    category: '',
    country: '',
    city: '',
    area: '',
    phone: '',
    email: '',
    website: '',
  });

  const update = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async () => {
    const result = await run(
      () =>
        api('/leads', {
          method: 'POST',
          body: {
            ...form,
            area: form.area || undefined,
            phone: form.phone || null,
            email: form.email || null,
            website: form.website || null,
          },
        }),
      { success: 'Lead added' },
    );
    if (result) {
      onCreated();
      onClose();
      setForm({ businessName: '', category: '', country: '', city: '', area: '', phone: '', email: '', website: '' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a lead manually"
      description="Use this for a business you already know about. It will be scored the next time you research it."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={pending || !form.businessName || !form.category || !form.city || !form.country}
          >
            {pending && <Spinner />}
            Add lead
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name">
          <input className="input" value={form.businessName} onChange={update('businessName')} />
        </Field>
        <Field label="Category">
          <input className="input" value={form.category} onChange={update('category')} placeholder="Restaurants" />
        </Field>
        <Field label="Country">
          <input className="input" value={form.country} onChange={update('country')} />
        </Field>
        <Field label="City">
          <input className="input" value={form.city} onChange={update('city')} />
        </Field>
        <Field label="Area">
          <input className="input" value={form.area} onChange={update('area')} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={update('phone')} />
        </Field>
        <Field label="Email" hint="Only enter an address the business publishes.">
          <input className="input" type="email" value={form.email} onChange={update('email')} />
        </Field>
        <Field label="Website">
          <input className="input" value={form.website} onChange={update('website')} />
        </Field>
      </div>
    </Modal>
  );
}
