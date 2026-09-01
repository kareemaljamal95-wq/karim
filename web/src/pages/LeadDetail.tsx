import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Globe,
  Mail,
  MapPin,
  MessageSquarePlus,
  Phone,
  Search,
  Send,
  Sparkles,
  Star,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery } from '../lib/hooks';
import { currency, dateTime, percent, relativeTime, titleCase } from '../lib/format';
import {
  Badge,
  Card,
  DemoBadge,
  EmptyState,
  ErrorBlock,
  Field,
  GradeBadge,
  InfoNote,
  LoadingBlock,
  Modal,
  PageHeader,
  ScoreBar,
  SectionTitle,
  Spinner,
  StatusBadge,
} from '../components/ui';
import type { Approval, ActivityLog, ConversationEntry, Lead, Message, Project } from '../lib/types';

interface LeadDetailResponse {
  lead: Lead;
  messages: Message[];
  conversations: ConversationEntry[];
  projects: Project[];
  approvals: Approval[];
  activity: ActivityLog[];
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

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { run, pending } = useAction();
  const { data, loading, error, refetch } = useQuery<LeadDetailResponse>(id ? `/leads/${id}` : null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  if (loading) return <LoadingBlock label="Loading lead" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  const { lead, messages, conversations, projects, approvals, activity } = data;
  const breakdown = Object.entries(lead.scoreBreakdown).filter(
    ([key, value]) => key !== 'caveats' && typeof value === 'number',
  ) as [string, number][];

  const updateStatus = (status: string) =>
    run(() => api(`/leads/${lead.id}`, { method: 'PATCH', body: { status } }), {
      success: `Status set to ${status.replace(/_/g, ' ').toLowerCase()}`,
      onSuccess: refetch,
    });

  const saveNotes = () =>
    run(() => api(`/leads/${lead.id}`, { method: 'PATCH', body: { notes: notes ?? '' } }), {
      success: 'Notes saved',
      onSuccess: () => {
        setNotes(null);
        refetch();
      },
    });

  /**
   * Fetches the lead's own website and re-scores it on what is actually there.
   * Read-only as far as the business is concerned — nothing is sent to them.
   */
  const verifyWebsite = () =>
    run(() => api(`/leads/${lead.id}/verify-website`, { method: 'POST', body: {} }), {
      success: 'Website checked — the score now reflects what was found on the site',
      onSuccess: refetch,
    });

  const draftOutreach = () =>
    run(() => api(`/leads/${lead.id}/draft-outreach`, { method: 'POST', body: {} }), {
      success: 'Drafts generated and sent for approval',
      onSuccess: refetch,
    });

  return (
    <div className="space-y-6">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to leads
      </Link>

      <PageHeader
        title={lead.businessName}
        description={`${lead.category} · ${[lead.area, lead.city, lead.country].filter(Boolean).join(', ')}`}
        actions={
          <>
            {can('analyst') && lead.website && (
              <button
                type="button"
                className="btn-secondary"
                onClick={verifyWebsite}
                disabled={pending}
                title="Visit this website and record what is actually on it"
              >
                {pending ? <Spinner /> : <Search className="h-4 w-4" />}
                Verify website
              </button>
            )}
            {can('analyst') && (
              <button type="button" className="btn-secondary" onClick={draftOutreach} disabled={pending}>
                {pending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                Draft outreach
              </button>
            )}
            {can('analyst') && (
              <button type="button" className="btn-secondary" onClick={() => setReplyOpen(true)}>
                <MessageSquarePlus className="h-4 w-4" />
                Log a reply
              </button>
            )}
            {can('operator') && (
              <select
                className="input w-auto"
                value={lead.status}
                onChange={(event) => updateStatus(event.target.value)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {lead.isDemo && (
        <InfoNote tone="warning">
          This is a <strong>demo record</strong> generated for evaluation. It does not describe a real business.
        </InfoNote>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionTitle hint={`Confidence ${percent((lead.confidence ?? 0) * 100)}`}>
              Opportunity assessment
            </SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Opportunity score</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {lead.opportunityScore ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Lead score</p>
                <p className="mt-1 flex items-baseline gap-2 text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {lead.leadScore ?? '—'}
                  <GradeBadge grade={lead.leadGrade} />
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Estimated value</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {currency(lead.estimatedValue)}
                </p>
              </div>
            </div>

            {lead.problem && (
              <div className="mt-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Problem observed</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{lead.problem}</p>
              </div>
            )}
            {lead.reason && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Why {lead.recommendedServiceLabel ?? 'this service'}
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{lead.reason}</p>
              </div>
            )}
            {Array.isArray(lead.scoreBreakdown.caveats) && lead.scoreBreakdown.caveats.length > 0 && (
              <div className="mt-4">
                <InfoNote tone="warning">
                  <ul className="list-inside list-disc space-y-1">
                    {lead.scoreBreakdown.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </InfoNote>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle hint="Each signal carries the evidence behind it">Evidence</SectionTitle>
            {lead.signals.length === 0 ? (
              <EmptyState title="No signals recorded" description="Run research on this lead to collect evidence." />
            ) : (
              <ul className="space-y-3">
                {lead.signals.map((signal) => (
                  <li key={signal.key} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{signal.label}</span>
                      <Badge tone="neutral">confidence {Math.round(signal.confidence * 100)}%</Badge>
                      <Badge tone="brand">weight {signal.weight}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{signal.evidence}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle hint="Seven dimensions, 0-100 each">Lead score breakdown</SectionTitle>
            {breakdown.length === 0 ? (
              <EmptyState title="Not scored yet" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {breakdown.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-600 dark:text-slate-300">{titleCase(key)}</span>
                    <ScoreBar value={value} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle hint={`${messages.length} total`}>Messages</SectionTitle>
            {messages.length === 0 ? (
              <EmptyState
                title="No messages drafted"
                description="Generate personalised outreach — it will go to the approval queue, never straight out."
              />
            ) : (
              <ul className="space-y-3">
                {messages.map((message) => (
                  <li key={message.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone="info">{message.channel}</Badge>
                      <StatusBadge status={message.status} />
                      <span className="ml-auto text-xs text-slate-400">{relativeTime(message.createdAt)}</span>
                    </div>
                    {message.subject && (
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{message.subject}</p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">
                      {message.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle hint={`${conversations.length} entries`}>Conversation</SectionTitle>
            {conversations.length === 0 ? (
              <EmptyState title="No conversation yet" />
            ) : (
              <ul className="space-y-3">
                {conversations.map((entry) => (
                  <li
                    key={entry.id}
                    className={`rounded-xl border p-3 ${
                      entry.direction === 'inbound'
                        ? 'border-brand-200 bg-brand-50/40 dark:border-brand-500/25 dark:bg-brand-500/5'
                        : 'border-slate-200 dark:border-white/10'
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={entry.direction === 'inbound' ? 'brand' : 'neutral'}>{entry.direction}</Badge>
                      {entry.intent && <Badge tone="purple">{entry.intent.replace(/_/g, ' ')}</Badge>}
                      {entry.sentiment && <Badge tone="neutral">{entry.sentiment}</Badge>}
                      {entry.requiresHuman && <Badge tone="warning">human review</Badge>}
                      <span className="ml-auto text-xs text-slate-400">{relativeTime(entry.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{entry.body}</p>
                    {(entry.buyingSignals.length > 0 || entry.objections.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {entry.buyingSignals.map((signal) => (
                          <Badge key={signal} tone="success">
                            {signal}
                          </Badge>
                        ))}
                        {entry.objections.map((objection) => (
                          <Badge key={objection} tone="danger">
                            {objection}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Contact</SectionTitle>
            <dl className="space-y-2.5 text-sm">
              <ContactRow icon={<Phone className="h-4 w-4" />} value={lead.phone} />
              <ContactRow icon={<Mail className="h-4 w-4" />} value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <ContactRow icon={<Globe className="h-4 w-4" />} value={lead.website} href={lead.website ?? undefined} />
              <ContactRow icon={<MapPin className="h-4 w-4" />} value={lead.address} href={lead.mapsUrl ?? undefined} />
              <ContactRow
                icon={<Star className="h-4 w-4" />}
                value={lead.rating ? `${lead.rating} (${lead.reviewCount ?? 0} reviews)` : null}
              />
              <ContactRow icon={<Building2 className="h-4 w-4" />} value={lead.openingHours} />
            </dl>
            {Object.keys(lead.socialLinks).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(lead.socialLinks).map(([name, url]) => (
                  <a key={name} href={url} target="_blank" rel="noreferrer" className="btn-secondary px-2.5 py-1 text-xs">
                    {name}
                  </a>
                ))}
              </div>
            )}
            {!lead.email && !lead.phone && (
              <div className="mt-3">
                <InfoNote tone="warning">
                  No public contact channel is on file. The platform will not invent one — add it manually if you
                  have it.
                </InfoNote>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Pipeline</SectionTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusBadge status={lead.status} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Last contact</dt>
                <dd className="text-slate-700 dark:text-slate-300">{dateTime(lead.lastContactAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-700 dark:text-slate-300">{dateTime(lead.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Source</dt>
                <dd className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  {lead.source}
                  {lead.isDemo && <DemoBadge />}
                </dd>
              </div>
            </dl>
            {lead.nextAction && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/[0.04]">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next action</p>
                <p className="mt-1 text-slate-700 dark:text-slate-300">{lead.nextAction}</p>
              </div>
            )}
          </Card>

          {approvals.length > 0 && (
            <Card>
              <SectionTitle>Approvals</SectionTitle>
              <ul className="space-y-2 text-sm">
                {approvals.map((approval) => (
                  <li key={approval.id} className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-300">{approval.title}</span>
                    <StatusBadge status={approval.status} />
                  </li>
                ))}
              </ul>
              <Link to="/approvals" className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400">
                Open approvals
              </Link>
            </Card>
          )}

          {projects.length > 0 && (
            <Card>
              <SectionTitle>Projects</SectionTitle>
              <ul className="space-y-2 text-sm">
                {projects.map((project) => (
                  <li key={project.id}>
                    <p className="font-medium text-slate-800 dark:text-slate-100">{project.title}</p>
                    <p className="text-xs text-slate-500">{project.status.replace(/_/g, ' ').toLowerCase()}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {can('operator') && (
            <Card>
              <SectionTitle>Notes</SectionTitle>
              <textarea
                className="input min-h-[120px]"
                value={notes ?? lead.notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything a teammate should know about this lead…"
              />
              <button type="button" className="btn-primary mt-3 w-full" onClick={saveNotes} disabled={pending || notes === null}>
                {pending && <Spinner />}
                Save notes
              </button>
            </Card>
          )}

          <Card>
            <SectionTitle>Activity</SectionTitle>
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {activity.slice(0, 12).map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p className="text-slate-700 dark:text-slate-300">{entry.message}</p>
                    <p className="text-xs text-slate-400">
                      {entry.actor} · {relativeTime(entry.ts)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <LogReplyModal leadId={lead.id} open={replyOpen} onClose={() => setReplyOpen(false)} onDone={refetch} />
    </div>
  );
}

function ContactRow({ icon, value, href }: { icon: React.ReactNode; value: string | null; href?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      {value ? (
        href ? (
          <a href={href} target="_blank" rel="noreferrer" className="break-all text-brand-600 hover:underline dark:text-brand-400">
            {value}
          </a>
        ) : (
          <span className="break-all text-slate-700 dark:text-slate-300">{value}</span>
        )
      ) : (
        <span className="text-slate-400">Not published</span>
      )}
    </div>
  );
}

function LogReplyModal({
  leadId,
  open,
  onClose,
  onDone,
}: {
  leadId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { run, pending } = useAction();
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState('email');

  const submit = async () => {
    const result = await run(
      () => api('/conversations/reply', { method: 'POST', body: { leadId, channel, body } }),
      { success: 'Reply analysed by the Conversation Agent' },
    );
    if (result) {
      setBody('');
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log an inbound reply"
      description="Paste what the prospect said. The Conversation Agent will classify it and prepare next steps."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || body.trim().length < 2}>
            {pending ? <Spinner /> : <Send className="h-4 w-4" />}
            Analyse reply
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Channel">
          <select className="input" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </Field>
        <Field label="Their message">
          <textarea
            className="input min-h-[160px]"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="e.g. Thanks for reaching out — I need an app for my restaurant with online ordering and delivery. How much would that cost?"
          />
        </Field>
      </div>
    </Modal>
  );
}
