import { bit, db, nowIso, parseJson, toJson, unbit } from '../db';
import { newId } from '../util/crypto';
import { badRequest, conflict, failedDependency, notFound } from '../util/errors';
import type { MessageChannel, MessageStatus } from '../types';
import type { MessageQuality } from '../agents/outreachAgent';
import { isActive } from './integrations';
import { buildEmail, deliverEmail, emailDeliveryAvailable, sendingAddress } from '../tools/emailDelivery';
import { getSettings } from './settings';
import { log } from './logger';
import { getLead, updateLead } from './leads';

export interface Message {
  id: string;
  leadId: string;
  leadName: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  status: MessageStatus;
  variant: string;
  quality: Partial<MessageQuality>;
  generatedBy: string;
  editedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  sentAt: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    leadName: String(row.lead_name ?? ''),
    channel: row.channel as MessageChannel,
    subject: (row.subject as string) ?? null,
    body: String(row.body),
    status: row.status as MessageStatus,
    variant: String(row.variant ?? 'primary'),
    quality: parseJson<Partial<MessageQuality>>(row.quality, {}),
    generatedBy: String(row.generated_by),
    editedBy: (row.edited_by as string) ?? null,
    approvedBy: (row.approved_by as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    rejectedReason: (row.rejected_reason as string) ?? null,
    sentAt: (row.sent_at as string) ?? null,
    isDemo: unbit(row.is_demo),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const SELECT_WITH_LEAD = `
  SELECT m.*, l.business_name AS lead_name
  FROM messages m
  JOIN leads l ON l.id = m.lead_id
`;

export function createMessage(input: {
  leadId: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  quality?: Partial<MessageQuality>;
  variant?: string;
  generatedBy?: string;
  isDemo?: boolean;
}): Message {
  const lead = getLead(input.leadId);
  const id = newId();
  const now = nowIso();

  db()
    .prepare(
      `INSERT INTO messages (id, lead_id, channel, subject, body, status, variant, quality,
         generated_by, is_demo, created_at, updated_at)
       VALUES (@id, @lead_id, @channel, @subject, @body, 'APPROVAL_REQUIRED', @variant, @quality,
         @generated_by, @is_demo, @created_at, @updated_at)`,
    )
    .run({
      id,
      lead_id: input.leadId,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      variant: input.variant ?? 'primary',
      quality: toJson(input.quality ?? {}),
      generated_by: input.generatedBy ?? 'outreach_agent',
      is_demo: bit(input.isDemo ?? lead.isDemo),
      created_at: now,
      updated_at: now,
    });

  return getMessage(id);
}

export function getMessage(id: string): Message {
  const row = db().prepare(`${SELECT_WITH_LEAD} WHERE m.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Message not found');
  return mapMessage(row);
}

export function listMessages(
  query: { status?: MessageStatus; leadId?: string; channel?: MessageChannel; limit?: number } = {},
): Message[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.status) {
    where.push('m.status = @status');
    params.status = query.status;
  }
  if (query.leadId) {
    where.push('m.lead_id = @leadId');
    params.leadId = query.leadId;
  }
  if (query.channel) {
    where.push('m.channel = @channel');
    params.channel = query.channel;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db()
    .prepare(`${SELECT_WITH_LEAD} ${clause} ORDER BY m.created_at DESC LIMIT @limit`)
    .all({ ...params, limit: Math.min(query.limit ?? 100, 300) }) as Record<string, unknown>[];
  return rows.map(mapMessage);
}

/** Editing a message keeps it in the approval queue — edits never auto-approve. */
export function editMessage(
  id: string,
  patch: { subject?: string | null; body?: string },
  actor: string,
): Message {
  const message = getMessage(id);
  if (message.status === 'SENT') throw conflict('A sent message cannot be edited');

  db()
    .prepare(
      `UPDATE messages SET
         subject = CASE WHEN @subject_set = 1 THEN @subject ELSE subject END,
         body = COALESCE(@body, body),
         edited_by = @editor,
         status = 'APPROVAL_REQUIRED',
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      subject: patch.subject ?? null,
      subject_set: patch.subject === undefined ? 0 : 1,
      body: patch.body ?? null,
      editor: actor,
      updated_at: nowIso(),
    });

  log({
    actorType: 'user',
    actor,
    action: 'message.edited',
    entityType: 'message',
    entityId: id,
    message: `Message to ${message.leadName} edited; it remains pending approval`,
  });

  return getMessage(id);
}

export function markApproved(id: string, actor: string): Message {
  db()
    .prepare(
      `UPDATE messages SET status = 'APPROVED', approved_by = @actor, approved_at = @ts,
         rejected_reason = NULL, updated_at = @ts WHERE id = @id`,
    )
    .run({ id, actor, ts: nowIso() });
  return getMessage(id);
}

export function markRejected(id: string, actor: string, reason?: string): Message {
  db()
    .prepare(
      `UPDATE messages SET status = 'REJECTED', approved_by = NULL, approved_at = NULL,
         rejected_reason = @reason, updated_at = @ts WHERE id = @id`,
    )
    .run({ id, reason: reason ?? null, ts: nowIso() });
  log({
    actorType: 'user',
    actor,
    action: 'message.rejected',
    entityType: 'message',
    entityId: id,
    message: `Message rejected${reason ? `: ${reason}` : ''}`,
  });
  return getMessage(id);
}

export interface SendOutcome {
  message: Message;
  dispatched: boolean;
  reason: string;
}

/**
 * Whether a channel has something that can actually deliver.
 *
 * Email has two possible transports, so it asks the delivery layer rather than
 * naming one connector.
 */
function channelConnected(channel: MessageChannel): boolean {
  if (channel === 'email') return emailDeliveryAvailable();
  if (channel === 'whatsapp') return isActive('whatsapp_business');
  return false;
}

/** How many messages actually left the platform since midnight UTC. */
function countSentToday(): number {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const row = db()
    .prepare(`SELECT COUNT(*) AS c FROM messages WHERE status = 'SENT' AND sent_at >= @since`)
    .get({ since: since.toISOString() }) as { c: number };
  return row.c;
}

/**
 * Hands the message to the channel that owns it.
 *
 * Only email is wired to a provider today. A channel without one reports that
 * plainly rather than pretending the message went out — the caller then leaves
 * it approved and queued.
 */
async function deliverChannel(
  message: Message,
  settings: ReturnType<typeof getSettings>,
): Promise<{ delivered: boolean; detail: string }> {
  if (message.channel !== 'email') {
    return {
      delivered: false,
      detail: `Delivery over ${message.channel} is not implemented yet, so nothing was sent.`,
    };
  }

  const lead = getLead(message.leadId);
  if (!lead.email) {
    return { delivered: false, detail: 'This lead has no email address on record.' };
  }

  const from = sendingAddress();
  if (!from) {
    return { delivered: false, detail: 'No email transport has a sending address configured.' };
  }

  return deliverEmail(buildEmail(message, lead.email, from, settings));
}

/**
 * Dispatch gate for approved messages.
 *
 * Four independent conditions must all hold before anything leaves the
 * platform: the message is approved, outbound sending is switched on, the
 * channel's integration is connected, and today's outreach cap has room. Until
 * then the message stays APPROVED and is queued — which is the intended MVP
 * behaviour, not an error.
 *
 * A message is only recorded as SENT once the provider actually accepted it. A
 * failed delivery leaves it APPROVED with the reason attached, because a status
 * that overstates what happened is worse than no automation at all.
 */
export async function sendMessage(id: string, actor: string): Promise<SendOutcome> {
  const message = getMessage(id);
  const settings = getSettings();

  if (message.status === 'SENT') throw conflict('This message was already sent');
  if (message.status !== 'APPROVED') {
    throw conflict('Only an approved message can be sent');
  }

  if (!settings.outboundSendingEnabled) {
    return {
      message,
      dispatched: false,
      reason:
        'Outbound sending is disabled. The message stays approved and queued until sending is enabled in Settings and the environment.',
    };
  }

  // A demo record's address is fictional, so a send can only bounce — and a
  // bounce from a new domain costs sender reputation that takes weeks to earn
  // back. The queue mixes demo and live leads by design, so the gate is what
  // keeps a sample record from ever reaching a mail server.
  if (message.isDemo || getLead(message.leadId).isDemo) {
    return {
      message,
      dispatched: false,
      reason:
        'This message belongs to a demo record, whose contact details are fictional. It stays approved and is never delivered.',
    };
  }

  if (!channelConnected(message.channel)) {
    throw failedDependency(
      `The ${message.channel} channel has no connected integration, so the message cannot be delivered yet.`,
    );
  }

  const sentToday = countSentToday();
  if (sentToday >= settings.dailyOutreachCap) {
    return {
      message,
      dispatched: false,
      reason: `Today's outreach cap of ${settings.dailyOutreachCap} has been reached (${sentToday} sent). The message stays approved and can go out tomorrow, or raise the cap in Settings.`,
    };
  }

  const delivery = await deliverChannel(message, settings);
  if (!delivery.delivered) {
    log({
      level: 'warn',
      actorType: 'user',
      actor,
      action: 'message.delivery_failed',
      entityType: 'message',
      entityId: id,
      message: `Delivery to ${message.leadName} failed: ${delivery.detail}`,
    });
    return {
      message,
      dispatched: false,
      reason: `The message was not delivered and stays approved. ${delivery.detail}`,
    };
  }

  const now = nowIso();
  db()
    .prepare(`UPDATE messages SET status = 'SENT', sent_at = @ts, updated_at = @ts WHERE id = @id`)
    .run({ id, ts: now });

  updateLead(message.leadId, { status: 'CONTACTED', lastContactAt: now }, actor);

  db()
    .prepare(
      `INSERT INTO conversations (id, lead_id, message_id, direction, channel, body, created_at)
       VALUES (@id, @lead_id, @message_id, 'outbound', @channel, @body, @created_at)`,
    )
    .run({
      id: newId(),
      lead_id: message.leadId,
      message_id: message.id,
      channel: message.channel,
      body: message.body,
      created_at: now,
    });

  log({
    level: 'warn',
    actorType: 'user',
    actor,
    action: 'message.sent',
    entityType: 'message',
    entityId: id,
    message: `Message delivered to ${message.leadName} over ${message.channel}. ${delivery.detail}`,
  });

  return { message: getMessage(id), dispatched: true, reason: delivery.detail };
}

/**
 * Records that a human sent this message themselves, outside the platform.
 *
 * The platform can draft, score and hold a message without being able to
 * deliver it — a blocked SMTP port or a lead with only a phone number are both
 * ordinary. Refusing to track what the operator then did by hand would leave
 * the pipeline lying about its own state: the lead never advances, the follow-up
 * never surfaces, and the reply has nothing to attach to.
 *
 * It is recorded as a manual dispatch, never as one the platform performed.
 */
export function markSentManually(id: string, actor: string, note?: string): Message {
  const message = getMessage(id);
  if (message.status === 'SENT') throw conflict('This message is already marked as sent');
  if (message.status !== 'APPROVED') throw conflict('Only an approved message can be marked as sent');

  const now = nowIso();
  db()
    .prepare(`UPDATE messages SET status = 'SENT', sent_at = @ts, updated_at = @ts WHERE id = @id`)
    .run({ id, ts: now });

  updateLead(message.leadId, { status: 'CONTACTED', lastContactAt: now }, actor);

  db()
    .prepare(
      `INSERT INTO conversations (id, lead_id, message_id, direction, channel, body, created_at)
       VALUES (@id, @lead_id, @message_id, 'outbound', @channel, @body, @created_at)`,
    )
    .run({
      id: newId(),
      lead_id: message.leadId,
      message_id: message.id,
      channel: message.channel,
      body: message.body,
      created_at: now,
    });

  log({
    level: 'warn',
    actorType: 'user',
    actor,
    action: 'message.sent_manually',
    entityType: 'message',
    entityId: id,
    message: `${actor} sent the ${message.channel} message to ${message.leadName} by hand, outside the platform.${note ? ` Note: ${note}` : ''}`,
  });

  return getMessage(id);
}

export function messageStats(): { total: number; pending: number; approved: number; sent: number } {
  const row = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'APPROVAL_REQUIRED' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent
       FROM messages`,
    )
    .get() as Record<string, number | null>;
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    approved: row.approved ?? 0,
    sent: row.sent ?? 0,
  };
}

export function assertChannel(channel: string): MessageChannel {
  const allowed: MessageChannel[] = ['email', 'whatsapp', 'sms', 'linkedin'];
  if (!allowed.includes(channel as MessageChannel)) throw badRequest(`Unsupported channel "${channel}"`);
  return channel as MessageChannel;
}
