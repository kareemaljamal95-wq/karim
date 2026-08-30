import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOperator } from '../middleware/auth';
import {
  editMessage,
  getMessage,
  listMessages,
  markApproved,
  markRejected,
  messageStats,
  markSentManually,
  sendMessage,
} from '../services/messages';
import { findPendingApprovalFor, recordDecision } from '../services/approvals';
import { actorOf, asyncHandler, parseIntOr } from '../util/http';
import { getSettings } from '../services/settings';
import type { MessageChannel, MessageStatus } from '../types';

export const messagesRouter = Router();

messagesRouter.use(requireAuth);

messagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      items: listMessages({
        status: req.query.status as MessageStatus | undefined,
        leadId: req.query.leadId as string | undefined,
        channel: req.query.channel as MessageChannel | undefined,
        limit: parseIntOr(req.query.limit, 100),
      }),
      stats: messageStats(),
      sendingEnabled: getSettings().outboundSendingEnabled,
    });
  }),
);

messagesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ message: getMessage(req.params.id) });
  }),
);

const editSchema = z.object({
  subject: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
});

messagesRouter.patch(
  '/:id',
  requireOperator,
  asyncHandler(async (req, res) => {
    const patch = editSchema.parse(req.body);
    res.json({ message: editMessage(req.params.id, patch, actorOf(req)) });
  }),
);

const decisionSchema = z.object({ note: z.string().optional() });

messagesRouter.post(
  '/:id/approve',
  requireOperator,
  asyncHandler(async (req, res) => {
    const { note } = decisionSchema.parse(req.body ?? {});
    const message = markApproved(req.params.id, actorOf(req));
    // Keep any linked approval gate in step with the decision.
    const approval = findPendingApprovalFor('message', message.id);
    if (approval) recordDecision(approval.id, 'APPROVED', actorOf(req), note);
    res.json({
      message,
      note: getSettings().outboundSendingEnabled
        ? 'Approved. Use Send to dispatch it.'
        : 'Approved and queued. Outbound sending is currently disabled.',
    });
  }),
);

messagesRouter.post(
  '/:id/reject',
  requireOperator,
  asyncHandler(async (req, res) => {
    const { note } = decisionSchema.parse(req.body ?? {});
    const message = markRejected(req.params.id, actorOf(req), note);
    const approval = findPendingApprovalFor('message', message.id);
    if (approval) recordDecision(approval.id, 'REJECTED', actorOf(req), note);
    res.json({ message });
  }),
);

/**
 * Dispatch endpoint. Guarded three ways: the message must be approved, outbound
 * sending must be enabled, and the channel integration must be connected.
 */
/**
 * Marks an approved message as sent by hand. Used when delivery happens
 * outside the platform — a channel with no provider wired, or a lead reachable
 * only by phone.
 */
messagesRouter.post(
  '/:id/mark-sent',
  requireOperator,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    res.json({ message: markSentManually(req.params.id, actorOf(req), note) });
  }),
);

messagesRouter.post(
  '/:id/send',
  requireOperator,
  asyncHandler(async (req, res) => {
    const result = await sendMessage(req.params.id, actorOf(req));
    res.json(result);
  }),
);
