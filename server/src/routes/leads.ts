import { Router } from 'express';
import { z } from 'zod';
import { requireAnalyst, requireAuth, requireOperator } from '../middleware/auth';
import {
  deleteLead,
  getLead,
  leadFilterOptions,
  leadsToCsv,
  listLeads,
  updateLead,
  upsertLead,
} from '../services/leads';
import { listMessages } from '../services/messages';
import { listConversations } from '../services/conversations';
import { listProjects } from '../services/projects';
import { listApprovals } from '../services/approvals';
import { listLogs } from '../services/logger';
import { runOutreachAgent } from '../agents/outreachAgent';
import { verifyLeadWebsite } from '../orchestrator/verifyLead';
import { createMessage } from '../services/messages';
import { createApproval } from '../services/approvals';
import { serviceByKey } from '../domain/services';
import { actorOf, asyncHandler, parseBool, parseIntOr } from '../util/http';
import { badRequest } from '../util/errors';
import { LEAD_STATUSES, type LeadGrade, type LeadStatus, type MessageChannel } from '../types';
import { assertChannel } from '../services/messages';

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { items, total } = listLeads({
      status: req.query.status as LeadStatus | undefined,
      grade: req.query.grade as LeadGrade | undefined,
      city: req.query.city as string | undefined,
      category: req.query.category as string | undefined,
      service: req.query.service as string | undefined,
      minScore: req.query.minScore === undefined ? undefined : parseIntOr(req.query.minScore, 0),
      search: req.query.search as string | undefined,
      demoOnly: parseBool(req.query.demoOnly),
      liveOnly: parseBool(req.query.liveOnly),
      sort: req.query.sort as 'score' | 'created' | 'updated' | 'value' | undefined,
      limit: parseIntOr(req.query.limit, 50),
      offset: parseIntOr(req.query.offset, 0),
    });
    res.json({ items, total, filters: leadFilterOptions() });
  }),
);

leadsRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const { items } = listLeads({
      status: req.query.status as LeadStatus | undefined,
      grade: req.query.grade as LeadGrade | undefined,
      limit: 500,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(leadsToCsv(items));
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = getLead(req.params.id);
    res.json({
      lead,
      messages: listMessages({ leadId: lead.id }),
      conversations: listConversations({ leadId: lead.id }),
      projects: listProjects({ leadId: lead.id }),
      approvals: listApprovals({ leadId: lead.id }),
      activity: listLogs({ entityType: 'lead', entityId: lead.id, limit: 50 }).items,
    });
  }),
);

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES as [LeadStatus, ...LeadStatus[]]).optional(),
  notes: z.string().optional(),
  nextAction: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  recommendedService: z.string().nullable().optional(),
  estimatedValue: z.number().int().nonnegative().nullable().optional(),
});

leadsRouter.patch(
  '/:id',
  requireOperator,
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    res.json({ lead: updateLead(req.params.id, patch, actorOf(req)) });
  }),
);

const manualLeadSchema = z.object({
  businessName: z.string().min(1),
  category: z.string().min(1),
  country: z.string().min(1),
  city: z.string().min(1),
  area: z.string().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().nullable().optional(),
  notes: z.string().optional(),
});

leadsRouter.post(
  '/',
  requireOperator,
  asyncHandler(async (req, res) => {
    const input = manualLeadSchema.parse(req.body);
    const { lead, created } = upsertLead({
      business: {
        name: input.businessName,
        category: input.category,
        country: input.country,
        city: input.city,
        area: input.area ?? '',
        phone: input.phone ?? null,
        email: input.email ?? null,
        website: input.website ?? null,
        socialLinks: {},
        source: 'manual',
        isDemo: false,
      },
      status: 'NEW',
    });
    if (input.notes) updateLead(lead.id, { notes: input.notes }, actorOf(req));
    res.status(created ? 201 : 200).json({ lead: getLead(lead.id), created });
  }),
);

leadsRouter.delete(
  '/:id',
  requireOperator,
  asyncHandler(async (req, res) => {
    deleteLead(req.params.id, actorOf(req));
    res.status(204).end();
  }),
);

const draftSchema = z.object({
  channels: z.array(z.string()).min(1).optional(),
});

/**
 * Visits this lead's website and re-scores it on what was actually found.
 *
 * Reads only: it fetches public pages and updates the lead's own analysis. It
 * cannot contact the business.
 */
leadsRouter.post(
  '/:id/verify-website',
  requireAnalyst,
  asyncHandler(async (req, res) => {
    const result = await verifyLeadWebsite(req.params.id, actorOf(req));
    res.json(result);
  }),
);

/**
 * Generates outreach drafts for a single lead on demand. The drafts always land
 * in the approval queue — this endpoint cannot send anything.
 */
leadsRouter.post(
  '/:id/draft-outreach',
  requireAnalyst,
  asyncHandler(async (req, res) => {
    const body = draftSchema.parse(req.body ?? {});
    const lead = getLead(req.params.id);

    if (!lead.email && !lead.phone) {
      throw badRequest('This lead has no public contact channel, so no outreach can be drafted.');
    }

    const channels: MessageChannel[] = (body.channels ?? ['email', 'whatsapp']).map(assertChannel);

    const outcome = await runOutreachAgent(
      {
        businessName: lead.businessName,
        category: lead.category,
        city: lead.city,
        recommendedServiceLabel:
          lead.recommendedServiceLabel ??
          (lead.recommendedService ? (serviceByKey(lead.recommendedService)?.label ?? null) : null),
        problem: lead.problem ?? 'No specific problem has been recorded for this lead yet.',
        evidence: lead.signals.slice(0, 3).map((s) => s.evidence),
        benefit: lead.reason ?? 'A short conversation about their current setup.',
        hasEmail: Boolean(lead.email),
        hasPhone: Boolean(lead.phone),
      },
      channels,
      { actor: actorOf(req) },
    );

    const created = outcome.data.messages.map((message) =>
      createMessage({
        leadId: lead.id,
        channel: message.channel,
        subject: message.subject,
        body: message.body,
        quality: message.quality,
        variant: message.channel,
      }),
    );

    const approval = createApproval({
      kind: 'FIRST_OUTREACH',
      title: `First contact with ${lead.businessName}`,
      summary: `${created.length} draft(s) generated on request. Review before anything is sent.`,
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      payload: { channels },
      requestedBy: actorOf(req),
    });

    updateLead(lead.id, { status: 'APPROVAL_REQUIRED' }, actorOf(req));

    res.status(201).json({
      messages: created,
      approvalId: approval.id,
      validation: outcome.validation,
      notes: outcome.notes,
      usedLlm: outcome.usedLlm,
    });
  }),
);
