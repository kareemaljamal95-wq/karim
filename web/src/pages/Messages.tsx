import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, MessageSquare, Pencil, Send, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery, useSystemStatus } from '../lib/hooks';
import { relativeTime } from '../lib/format';
import {
  Badge,
  Card,
  DemoBadge,
  EmptyState,
  ErrorBlock,
  Field,
  InfoNote,
  LoadingBlock,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { StatTile } from '../components/StatTile';
import type { Message, MessageQuality } from '../lib/types';

interface MessagesResponse {
  items: Message[];
  stats: { total: number; pending: number; approved: number; sent: number };
  sendingEnabled: boolean;
}

const STATUSES = ['APPROVAL_REQUIRED', 'APPROVED', 'SENT', 'REJECTED'];
const CHANNELS = ['email', 'whatsapp', 'sms', 'linkedin'];

export function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { refresh } = useSystemStatus();
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<Message | null>(null);

  const status = params.get('status') ?? '';
  const channel = params.get('channel') ?? '';
  const query = `/messages?${new URLSearchParams({
    ...(status ? { status } : {}),
    ...(channel ? { channel } : {}),
    limit: '150',
  }).toString()}`;

  const { data, loading, error, refetch } = useQuery<MessagesResponse>(query, [status, channel]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const decide = (message: Message, decision: 'approve' | 'reject') =>
    run(() => api(`/messages/${message.id}/${decision}`, { method: 'POST', body: {} }), {
      success: decision === 'approve' ? 'Message approved' : 'Message rejected',
      onSuccess: () => {
        refetch();
        refresh();
      },
    });

  const send = (message: Message) =>
    run<{ dispatched: boolean; reason: string }>(
      () => api(`/messages/${message.id}/send`, { method: 'POST', body: {} }),
      {
        onSuccess: (result) => {
          refetch();
          refresh();
          if (result && !result.dispatched) {
            // Queued rather than delivered — surface exactly why.
            run(async () => result, { success: result.reason });
          }
        },
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description="Every message the Outreach and Conversation agents have written. Drafts stay here until a human approves them."
      />

      {data && !data.sendingEnabled && (
        <InfoNote tone="warning">
          <strong>Outbound sending is disabled.</strong> Approved messages are queued, not delivered. Enable
          sending in{' '}
          <Link to="/settings" className="font-medium underline">
            Settings
          </Link>{' '}
          and connect a channel in Integrations once you are ready to go live.
        </InfoNote>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Total drafted" value={data.stats.total} icon={<MessageSquare className="h-4 w-4" />} />
          <StatTile label="Awaiting approval" value={data.stats.pending} tone="warning" />
          <StatTile label="Approved" value={data.stats.approved} tone="brand" />
          <StatTile label="Sent" value={data.stats.sent} tone="success" />
        </div>
      )}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select className="input" value={status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select className="input" value={channel} onChange={(e) => setFilter('channel', e.target.value)}>
            <option value="">All channels</option>
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {loading && <LoadingBlock label="Loading messages" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {data && data.items.length === 0 && !loading && (
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="No messages yet"
          description="Run market research or generate outreach from a lead to create drafts."
          action={
            <Link to="/research" className="btn-primary">
              Run market research
            </Link>
          }
        />
      )}

      <div className="space-y-4">
        {data?.items.map((message) => (
          <Card key={message.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/leads/${message.leadId}`}
                    className="font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                  >
                    {message.leadName}
                  </Link>
                  <Badge tone="info">{message.channel}</Badge>
                  <StatusBadge status={message.status} />
                  {message.isDemo && <DemoBadge />}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Written by {message.generatedBy.replace(/_/g, ' ')} · {relativeTime(message.createdAt)}
                  {message.editedBy ? ` · edited by ${message.editedBy}` : ''}
                  {message.approvedBy ? ` · approved by ${message.approvedBy}` : ''}
                </p>
              </div>

              {can('operator') && (
                <div className="flex flex-wrap gap-2">
                  {message.status !== 'SENT' && (
                    <button type="button" className="btn-secondary" onClick={() => setEditing(message)}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                  )}
                  {message.status === 'APPROVAL_REQUIRED' && (
                    <>
                      <button
                        type="button"
                        className="btn-success"
                        onClick={() => decide(message, 'approve')}
                        disabled={pending}
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => decide(message, 'reject')}
                        disabled={pending}
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </>
                  )}
                  {message.status === 'APPROVED' && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => send(message)}
                      disabled={pending || !data?.sendingEnabled}
                      title={
                        data?.sendingEnabled
                          ? 'Dispatch over the connected channel'
                          : 'Outbound sending is disabled in Settings'
                      }
                    >
                      {pending ? <Spinner /> : <Send className="h-4 w-4" />}
                      Send
                    </button>
                  )}
                </div>
              )}
            </div>

            {message.subject && (
              <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">{message.subject}</p>
            )}
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {message.body}
            </p>

            <QualityFlags quality={message.quality} />

            {message.rejectedReason && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">Rejected: {message.rejectedReason}</p>
            )}
          </Card>
        ))}
      </div>

      <EditMessageModal
        message={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          refetch();
          setEditing(null);
        }}
      />
    </div>
  );
}

/**
 * The Outreach Agent scores every draft against the message-quality rules. These
 * flags are what a reviewer needs to see before approving anything.
 */
function QualityFlags({ quality }: { quality: MessageQuality }) {
  if (!quality || Object.keys(quality).length === 0) return null;

  const problems: string[] = [
    ...(quality.forbiddenClaims ?? []).map((claim) => `Forbidden claim "${claim.phrase}" — ${claim.reason}`),
    ...(quality.impersonation ?? []).map((phrase) => `Implies a human sender: "${phrase}"`),
    ...(quality.spamPhrases ?? []).map((phrase) => `Spam phrasing: "${phrase}"`),
  ];

  const checks = [
    { label: 'Names the business', ok: quality.mentionsBusinessName },
    { label: 'Points at real evidence', ok: quality.referencesEvidence },
    { label: 'Discloses AI', ok: quality.disclosesAi },
    { label: 'Within length limit', ok: quality.withinLengthLimit },
  ].filter((check) => check.ok !== undefined);

  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
      <div className="flex flex-wrap items-center gap-2">
        {typeof quality.score === 'number' && (
          <Badge tone={quality.score >= 80 ? 'success' : quality.score >= 60 ? 'warning' : 'danger'}>
            <ShieldCheck className="h-3 w-3" />
            quality {quality.score}
          </Badge>
        )}
        {checks.map((check) => (
          <Badge key={check.label} tone={check.ok ? 'success' : 'warning'}>
            {check.ok ? '✓' : '✕'} {check.label}
          </Badge>
        ))}
      </div>
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditMessageModal({
  message,
  onClose,
  onSaved,
}: {
  message: Message | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run, pending } = useAction();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);

  // Load the message content the first time this draft opens.
  if (message && loaded !== message.id) {
    setLoaded(message.id);
    setSubject(message.subject ?? '');
    setBody(message.body);
  }

  const save = async () => {
    if (!message) return;
    const result = await run(
      () =>
        api(`/messages/${message.id}`, {
          method: 'PATCH',
          body: { subject: message.channel === 'email' ? subject : null, body },
        }),
      { success: 'Saved. The message stays in the approval queue.' },
    );
    if (result) onSaved();
  };

  return (
    <Modal
      open={Boolean(message)}
      onClose={onClose}
      title="Edit message"
      description="Editing keeps the message in APPROVAL_REQUIRED — an edit never auto-approves."
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={pending || body.trim().length < 5}>
            {pending && <Spinner />}
            Save changes
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {message?.channel === 'email' && (
          <Field label="Subject">
            <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </Field>
        )}
        <Field label="Body">
          <textarea
            className="input min-h-[260px] font-sans leading-relaxed"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <SectionTitle>Reminder</SectionTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Do not add prices, guarantees or statistics you cannot support, and keep the line that discloses the
          message comes from an AI assistant.
        </p>
      </div>
    </Modal>
  );
}
