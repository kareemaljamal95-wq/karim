import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckSquare, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery, useSystemStatus } from '../lib/hooks';
import { relativeTime, titleCase } from '../lib/format';
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
import type { Approval } from '../lib/types';

interface ApprovalsResponse {
  items: Approval[];
}

interface DecisionResult {
  effects: string[];
  dispatched: boolean;
}

const KIND_TONES: Record<string, 'brand' | 'warning' | 'danger' | 'purple'> = {
  FIRST_OUTREACH: 'brand',
  COMMERCIAL_COMMITMENT: 'danger',
  PRICE_AGREEMENT: 'danger',
  PROJECT_ACCEPTANCE: 'purple',
  DELIVERABLE_SEND: 'warning',
  IRREVERSIBLE_ACTION: 'danger',
};

/**
 * The human-in-the-loop centre. Every irreversible or externally-visible action
 * the platform wants to take waits here, with the actual content it is holding.
 */
export function ApprovalsPage() {
  const [tab, setTab] = useState<'PENDING' | 'DECIDED'>('PENDING');
  const { can } = useAuth();
  const { refresh } = useSystemStatus();
  const { run, pending } = useAction();
  const [decision, setDecision] = useState<{ approval: Approval; verdict: 'APPROVED' | 'REJECTED' } | null>(null);

  const { data, loading, error, refetch } = useQuery<ApprovalsResponse>(
    tab === 'PENDING' ? '/approvals?status=PENDING' : '/approvals?limit=100',
    [tab],
  );

  const items = (data?.items ?? []).filter((approval) =>
    tab === 'PENDING' ? approval.status === 'PENDING' : approval.status !== 'PENDING',
  );

  const submit = async (note: string) => {
    if (!decision) return;
    const result = await run<DecisionResult>(
      () =>
        api(`/approvals/${decision.approval.id}/decide`, {
          method: 'POST',
          body: { decision: decision.verdict, note: note || undefined },
        }),
      { success: decision.verdict === 'APPROVED' ? 'Approved' : 'Rejected' },
    );
    if (result) {
      setDecision(null);
      refetch();
      refresh();
      if (result.effects.length) {
        // Say plainly what actually happened — approved does not mean sent.
        run(async () => result, { success: result.effects.join(' ') });
      }
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Nothing leaves this platform without a decision here. Review the exact content, then approve or reject."
      />

      <InfoNote>
        The AI CEO must request approval before the first external message, any commercial commitment, any price
        agreement, accepting a project, sending deliverables, and any other irreversible action.
      </InfoNote>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-white/[0.03]">
        {(['PENDING', 'DECIDED'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === value
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/[0.04]'
            }`}
          >
            {value === 'PENDING' ? 'Waiting for you' : 'History'}
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Loading approvals" />}
      {error && <ErrorBlock message={error} onRetry={refetch} />}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={<CheckSquare className="h-6 w-6" />}
          title={tab === 'PENDING' ? 'Nothing waiting for you' : 'No decisions yet'}
          description={
            tab === 'PENDING'
              ? 'Every approval gate is clear. New gates appear here as the agents work.'
              : 'Approved and rejected items will be listed here.'
          }
        />
      )}

      <div className="space-y-4">
        {items.map((approval) => (
          <Card key={approval.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONES[approval.kind] ?? 'neutral'}>
                    <ShieldAlert className="h-3 w-3" />
                    {titleCase(approval.kind)}
                  </Badge>
                  <StatusBadge status={approval.status} />
                  {approval.lead?.isDemo && <DemoBadge />}
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{approval.title}</h3>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{approval.summary}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Requested by {approval.requestedBy.replace(/_/g, ' ')} · {relativeTime(approval.createdAt)}
                  {approval.decidedBy ? ` · decided by ${approval.decidedBy} ${relativeTime(approval.decidedAt)}` : ''}
                </p>
              </div>

              {approval.status === 'PENDING' && can('operator') && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-success"
                    onClick={() => setDecision({ approval, verdict: 'APPROVED' })}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDecision({ approval, verdict: 'REJECTED' })}
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              )}
            </div>

            {approval.lead && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm dark:bg-white/[0.04]">
                <Link
                  to={`/leads/${approval.lead.id}`}
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {approval.lead.businessName}
                </Link>
                <span className="text-slate-500 dark:text-slate-400">
                  {approval.lead.category} · {approval.lead.city}
                </span>
                {approval.lead.recommendedServiceLabel && (
                  <Badge tone="brand">{approval.lead.recommendedServiceLabel}</Badge>
                )}
                <span className="text-slate-500 dark:text-slate-400">
                  Opportunity {approval.lead.opportunityScore ?? '—'} · Lead {approval.lead.leadScore ?? '—'}
                </span>
              </div>
            )}

            {Array.isArray(approval.payload.evidence) && (approval.payload.evidence as string[]).length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence behind this</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-600 dark:text-slate-400">
                  {(approval.payload.evidence as string[]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(approval.payload.missingInformation) &&
              (approval.payload.missingInformation as string[]).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Still unknown before this can be quoted
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(approval.payload.missingInformation as string[]).map((item) => (
                      <Badge key={item} tone="warning">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

            {approval.messages && approval.messages.length > 0 && (
              <div className="mt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Content being held ({approval.messages.length})
                </p>
                {approval.messages.map((message) => (
                  <div key={message.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone="info">{message.channel}</Badge>
                      <StatusBadge status={message.status} />
                      {typeof message.quality.score === 'number' && (
                        <Badge tone={message.quality.score >= 80 ? 'success' : 'warning'}>
                          quality {message.quality.score}
                        </Badge>
                      )}
                    </div>
                    {message.subject && (
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{message.subject}</p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">
                      {message.body}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {approval.decisionNote && (
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-400">
                Note: {approval.decisionNote}
              </p>
            )}
          </Card>
        ))}
      </div>

      <DecisionModal
        decision={decision}
        pending={pending}
        onClose={() => setDecision(null)}
        onSubmit={submit}
      />
    </div>
  );
}

function DecisionModal({
  decision,
  pending,
  onClose,
  onSubmit,
}: {
  decision: { approval: Approval; verdict: 'APPROVED' | 'REJECTED' } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const approving = decision?.verdict === 'APPROVED';

  return (
    <Modal
      open={Boolean(decision)}
      onClose={onClose}
      title={approving ? 'Approve this action' : 'Reject this action'}
      description={decision?.approval.title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={approving ? 'btn-success' : 'btn-danger'}
            onClick={() => {
              onSubmit(note);
              setNote('');
            }}
            disabled={pending}
          >
            {pending && <Spinner />}
            {approving ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {approving ? (
          <InfoNote>
            Approving releases the held content. If outbound sending is disabled, the messages are queued as
            approved rather than delivered — you will be told which happened.
          </InfoNote>
        ) : (
          <InfoNote tone="warning">
            Rejecting discards the drafts. For a first-contact gate, the lead is also marked NOT_A_FIT.
          </InfoNote>
        )}
        <Field label="Note" hint="Optional. Recorded in the audit log and shown on the approval.">
          <textarea
            className="input min-h-[110px]"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={approving ? 'Anything the team should know…' : 'Why is this being rejected?'}
          />
        </Field>
        <SectionTitle>Audit</SectionTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your decision, your name and this note are written to the activity log and cannot be edited afterwards.
        </p>
      </div>
    </Modal>
  );
}
