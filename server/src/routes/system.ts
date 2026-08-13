import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { analyticsBundle, overviewMetrics, systemStatus } from '../services/analytics';
import { getSettings, updateSettings } from '../services/settings';
import {
  INTEGRATION_CATALOG,
  listIntegrations,
  updateIntegration,
  type IntegrationKey,
} from '../services/integrations';
import { listLogs } from '../services/logger';
import { listApprovals } from '../services/approvals';
import { listLeads } from '../services/leads';
import { listMessages } from '../services/messages';
import { listRuns } from '../services/runs';
import { SERVICE_CATALOG } from '../domain/services';
import { LEAD_STATUSES } from '../types';
import { actorOf, asyncHandler, parseIntOr } from '../util/http';
import { badRequest } from '../util/errors';
import type { ActorType, LogLevel } from '../services/logger';

export const systemRouter = Router();

systemRouter.use(requireAuth);

/** Everything the dashboard shell needs in one call. */
systemRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json({
      metrics: overviewMetrics(),
      status: systemStatus(),
      pendingApprovals: listApprovals({ status: 'PENDING', limit: 6 }),
      recentLeads: listLeads({ sort: 'created', limit: 6 }).items,
      recentRuns: listRuns(5),
      recentActivity: listLogs({ limit: 12 }).items,
      draftMessages: listMessages({ status: 'APPROVAL_REQUIRED', limit: 5 }),
    });
  }),
);

systemRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    res.json(analyticsBundle());
  }),
);

systemRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json(systemStatus());
  }),
);

systemRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({
      services: SERVICE_CATALOG.map((s) => ({
        key: s.key,
        label: s.label,
        summary: s.summary,
        valueBand: s.valueBand,
        requiredSignals: s.requiredSignals,
      })),
      leadStatuses: LEAD_STATUSES,
      integrations: INTEGRATION_CATALOG.map((i) => ({ key: i.key, name: i.name, category: i.category })),
    });
  }),
);

systemRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    res.json(
      listLogs({
        level: req.query.level as LogLevel | undefined,
        actorType: req.query.actorType as ActorType | undefined,
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId as string | undefined,
        runId: req.query.runId as string | undefined,
        search: req.query.search as string | undefined,
        limit: parseIntOr(req.query.limit, 100),
        offset: parseIntOr(req.query.offset, 0),
      }),
    );
  }),
);

systemRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: getSettings() });
  }),
);

const settingsSchema = z.object({
  companyName: z.string().min(1).optional(),
  senderName: z.string().min(1).optional(),
  senderRole: z.string().optional(),
  replyToEmail: z.string().email().or(z.literal('')).optional(),
  websiteUrl: z.string().optional(),
  approvedClaims: z.array(z.string()).optional(),
  offeredServices: z.array(z.string()).optional(),
  pricingPolicy: z.string().optional(),
  outboundSendingEnabled: z.boolean().optional(),
  demoMode: z.boolean().optional(),
  defaultCountry: z.string().optional(),
  defaultCity: z.string().optional(),
  dailyOutreachCap: z.number().int().min(1).max(1000).optional(),
});

systemRouter.patch(
  '/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = settingsSchema.parse(req.body);
    if (patch.offeredServices) {
      const valid = new Set(SERVICE_CATALOG.map((s) => s.key));
      const unknown = patch.offeredServices.filter((s) => !valid.has(s as never));
      if (unknown.length) throw badRequest(`Unknown service key(s): ${unknown.join(', ')}`);
    }
    const settings = updateSettings(patch);
    res.json({ settings });
  }),
);

systemRouter.get(
  '/integrations',
  asyncHandler(async (_req, res) => {
    // Credential values are never returned — only masked hints and state.
    res.json({ items: listIntegrations() });
  }),
);

const integrationSchema = z.object({
  credentials: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

systemRouter.patch(
  '/integrations/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = integrationSchema.parse(req.body);
    const integration = updateIntegration(
      req.params.key as IntegrationKey,
      patch,
      actorOf(req),
    );
    res.json({ integration });
  }),
);
