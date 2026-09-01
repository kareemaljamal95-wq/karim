import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOperator } from '../middleware/auth';
import { getApproval, listApprovals } from '../services/approvals';
import { decideApproval } from '../services/approvalFlow';
import { listMessages } from '../services/messages';
import { findLead } from '../services/leads';
import { actorOf, asyncHandler, parseIntOr } from '../util/http';
import type { ApprovalStatus } from '../types';

export const approvalsRouter = Router();

approvalsRouter.use(requireAuth);

approvalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = listApprovals({
      status: (req.query.status as ApprovalStatus | undefined) ?? undefined,
      leadId: req.query.leadId as string | undefined,
      limit: parseIntOr(req.query.limit, 100),
    });

    // Attach the drafts each gate is holding so the reviewer sees the actual
    // content, not just a reference to it.
    const enriched = items.map((approval) => ({
      ...approval,
      lead: approval.leadId ? findLead(approval.leadId) : null,
      messages:
        approval.entityType === 'lead'
          ? listMessages({ leadId: approval.entityId })
          : approval.entityType === 'message'
            ? listMessages({ leadId: approval.leadId ?? '' }).filter((m) => m.id === approval.entityId)
            : [],
    }));

    res.json({ items: enriched });
  }),
);

approvalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const approval = getApproval(req.params.id);
    res.json({
      approval,
      lead: approval.leadId ? findLead(approval.leadId) : null,
      messages:
        approval.entityType === 'lead' ? listMessages({ leadId: approval.entityId }) : [],
    });
  }),
);

const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
});

approvalsRouter.post(
  '/:id/decide',
  requireOperator,
  asyncHandler(async (req, res) => {
    const { decision, note } = decisionSchema.parse(req.body);
    const result = await decideApproval(req.params.id, decision, actorOf(req), note);
    res.json(result);
  }),
);
