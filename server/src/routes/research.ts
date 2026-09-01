import { Router } from 'express';
import { z } from 'zod';
import { requireAnalyst, requireAuth } from '../middleware/auth';
import { runDiscoveryWorkflow } from '../orchestrator/engine';
import { getRun, listResearchRuns, listRuns } from '../services/runs';
import { actorOf, asyncHandler, parseIntOr } from '../util/http';
import { DEMO_CATEGORIES, DEMO_LOCATIONS, DEMO_NOTICE } from '../tools/demoData';
import { googlePlacesAvailable } from '../tools/googlePlaces';
import { getSettings } from '../services/settings';

export const researchRouter = Router();

researchRouter.use(requireAuth);

researchRouter.get(
  '/options',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    res.json({
      categories: DEMO_CATEGORIES,
      locations: DEMO_LOCATIONS,
      defaults: { country: settings.defaultCountry, city: settings.defaultCity },
      liveDiscovery: googlePlacesAvailable(),
      demoNotice: googlePlacesAvailable() ? null : DEMO_NOTICE,
    });
  }),
);

const searchSchema = z.object({
  country: z.string().min(1),
  city: z.string().min(1),
  area: z.string().optional(),
  category: z.string().min(1),
  limit: z.number().int().min(1).max(40).optional(),
  workflowId: z.string().optional(),
  draftOutreach: z.boolean().optional(),
  contactableOnly: z.boolean().optional(),
});

/**
 * Runs the full discovery workflow. Returns when the orchestrator has finished
 * every step up to the approval gate — no message is ever sent by this call.
 */
researchRouter.post(
  '/run',
  requireAnalyst,
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.body);
    const summary = await runDiscoveryWorkflow({
      ...input,
      workflowId: input.workflowId ?? null,
      actor: actorOf(req),
    });
    res.status(201).json(summary);
  }),
);

researchRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json({ items: listResearchRuns(parseIntOr(req.query.limit, 50)) });
  }),
);

researchRouter.get(
  '/executions',
  asyncHandler(async (req, res) => {
    res.json({ items: listRuns(parseIntOr(req.query.limit, 25)) });
  }),
);

researchRouter.get(
  '/executions/:id',
  asyncHandler(async (req, res) => {
    res.json({ run: getRun(req.params.id) });
  }),
);
