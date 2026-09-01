import { bit, db, nowIso, parseJson, toJson, unbit } from '../db';
import { newId } from '../util/crypto';
import { notFound } from '../util/errors';
import type { MessageChannel } from '../types';
import type { ConversationAnalysis } from '../agents/conversationAgent';

export interface ConversationEntry {
  id: string;
  leadId: string;
  messageId: string | null;
  direction: 'inbound' | 'outbound';
  channel: MessageChannel;
  body: string;
  intent: string | null;
  sentiment: string | null;
  buyingSignals: string[];
  objections: string[];
  requirements: string[];
  requiresHuman: boolean;
  suggestedReply: string | null;
  analysis: Record<string, unknown>;
  createdAt: string;
}

function mapConversation(row: Record<string, unknown>): ConversationEntry {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    messageId: (row.message_id as string) ?? null,
    direction: row.direction as 'inbound' | 'outbound',
    channel: row.channel as MessageChannel,
    body: String(row.body),
    intent: (row.intent as string) ?? null,
    sentiment: (row.sentiment as string) ?? null,
    buyingSignals: parseJson<string[]>(row.buying_signals, []),
    objections: parseJson<string[]>(row.objections, []),
    requirements: parseJson<string[]>(row.requirements, []),
    requiresHuman: unbit(row.requires_human),
    suggestedReply: (row.suggested_reply as string) ?? null,
    analysis: parseJson<Record<string, unknown>>(row.analysis, {}),
    createdAt: String(row.created_at),
  };
}

export function recordInboundReply(input: {
  leadId: string;
  channel: MessageChannel;
  body: string;
  analysis: ConversationAnalysis;
  messageId?: string | null;
}): ConversationEntry {
  const id = newId();
  db()
    .prepare(
      `INSERT INTO conversations (id, lead_id, message_id, direction, channel, body, intent, sentiment,
         buying_signals, objections, requirements, requires_human, suggested_reply, analysis, created_at)
       VALUES (@id, @lead_id, @message_id, 'inbound', @channel, @body, @intent, @sentiment,
         @buying_signals, @objections, @requirements, @requires_human, @suggested_reply, @analysis, @created_at)`,
    )
    .run({
      id,
      lead_id: input.leadId,
      message_id: input.messageId ?? null,
      channel: input.channel,
      body: input.body,
      intent: input.analysis.intent,
      sentiment: input.analysis.sentiment,
      buying_signals: toJson(input.analysis.buyingSignals),
      objections: toJson(input.analysis.objections),
      requirements: toJson(input.analysis.extractedRequirements),
      requires_human: bit(input.analysis.requiresHuman),
      suggested_reply: input.analysis.suggestedReply,
      analysis: toJson(input.analysis),
      created_at: nowIso(),
    });
  return getConversation(id);
}

export function getConversation(id: string): ConversationEntry {
  const row = db().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Conversation entry not found');
  return mapConversation(row);
}

export function listConversations(query: { leadId?: string; limit?: number } = {}): ConversationEntry[] {
  const clause = query.leadId ? 'WHERE lead_id = @leadId' : '';
  const rows = db()
    .prepare(`SELECT * FROM conversations ${clause} ORDER BY created_at DESC LIMIT @limit`)
    .all({ leadId: query.leadId, limit: Math.min(query.limit ?? 200, 500) }) as Record<
    string,
    unknown
  >[];
  return rows.map(mapConversation);
}

export function lastOutboundBody(leadId: string): string | null {
  const row = db()
    .prepare(
      `SELECT body FROM conversations WHERE lead_id = ? AND direction = 'outbound'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(leadId) as { body: string } | undefined;
  return row?.body ?? null;
}

export function replyCount(): number {
  return (
    db().prepare(`SELECT COUNT(*) AS c FROM conversations WHERE direction = 'inbound'`).get() as {
      c: number;
    }
  ).c;
}
