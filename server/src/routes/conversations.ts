import { Router } from 'express';
import { z } from 'zod';
import { requireAnalyst, requireAuth } from '../middleware/auth';
import { listConversations } from '../services/conversations';
import { handleInboundReply } from '../orchestrator/replies';
import { assertChannel } from '../services/messages';
import { actorOf, asyncHandler, parseIntOr } from '../util/http';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      items: listConversations({
        leadId: req.query.leadId as string | undefined,
        limit: parseIntOr(req.query.limit, 200),
      }),
    });
  }),
);

const replySchema = z.object({
  leadId: z.string().min(1),
  channel: z.string().default('email'),
  body: z.string().min(1).max(10000),
});

/**
 * Records an inbound reply and runs the conversation pipeline over it.
 *
 * Until a messaging integration is connected this is how replies enter the
 * system — it is the same code path a webhook would call, so the behaviour you
 * see here is the behaviour you get once the channel is live.
 */
conversationsRouter.post(
  '/reply',
  requireAnalyst,
  asyncHandler(async (req, res) => {
    const input = replySchema.parse(req.body);
    const result = await handleInboundReply({
      leadId: input.leadId,
      channel: assertChannel(input.channel),
      body: input.body,
      actor: actorOf(req),
    });
    res.status(201).json(result);
  }),
);
