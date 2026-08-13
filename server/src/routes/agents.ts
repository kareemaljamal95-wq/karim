import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { getAgent, listAgents, resetAgent, updateAgent } from '../agents/registry';
import { listTools } from '../tools/registry';
import { listLogs } from '../services/logger';
import { actorOf, asyncHandler } from '../util/http';
import { log } from '../services/logger';

export const agentsRouter = Router();

agentsRouter.use(requireAuth);

agentsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: listAgents(), tools: listTools() });
  }),
);

agentsRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const agent = getAgent(req.params.key);
    res.json({
      agent,
      tools: listTools(),
      recentActivity: listLogs({ actorType: 'agent', search: agent.key, limit: 40 }).items,
    });
  }),
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().min(20).optional(),
  tools: z.array(z.string()).optional(),
  allowedActions: z.array(z.string()).optional(),
  requiresApproval: z.boolean().optional(),
  maxActions: z.number().int().min(1).max(500).optional(),
  retryLimit: z.number().int().min(0).max(5).optional(),
  outputFormat: z.enum(['json', 'text', 'markdown']).optional(),
  enabled: z.boolean().optional(),
});

agentsRouter.patch(
  '/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = updateSchema.parse(req.body);
    const agent = updateAgent(req.params.key, patch);
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'agent.configured',
      entityType: 'agent',
      entityId: agent.key,
      message: `Agent "${agent.name}" configuration updated`,
      meta: { fields: Object.keys(patch) },
    });
    res.json({ agent });
  }),
);

agentsRouter.post(
  '/:key/reset',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const agent = resetAgent(req.params.key);
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'agent.reset',
      entityType: 'agent',
      entityId: agent.key,
      message: `Agent "${agent.name}" restored to shipped defaults`,
    });
    res.json({ agent });
  }),
);
