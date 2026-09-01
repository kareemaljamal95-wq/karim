import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOperator } from '../middleware/auth';
import {
  COMMITMENT_STATUSES,
  PROJECT_STATUSES,
  getProject,
  listProjects,
  updateProject,
  type ProjectStatus,
} from '../services/projects';
import { createApproval, findPendingApprovalFor } from '../services/approvals';
import { actorOf, asyncHandler } from '../util/http';
import { conflict } from '../util/errors';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      items: listProjects({
        status: req.query.status as ProjectStatus | undefined,
        leadId: req.query.leadId as string | undefined,
      }),
      statuses: PROJECT_STATUSES,
    });
  }),
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ project: getProject(req.params.id) });
  }),
);

const patchSchema = z.object({
  status: z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]).optional(),
  notes: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  missingInformation: z.array(z.string()).optional(),
  estimatedValue: z.number().int().nonnegative().nullable().optional(),
});

projectsRouter.patch(
  '/:id',
  requireOperator,
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const project = getProject(req.params.id);

    // Accepting a project is a commercial commitment: it needs its own gate.
    if (patch.status && COMMITMENT_STATUSES.includes(patch.status)) {
      const pending = findPendingApprovalFor('project', project.id);
      if (pending) {
        throw conflict(
          'This project has an open approval. Decide it on the Approvals page before changing the status.',
        );
      }
      const approval = createApproval({
        kind: 'PROJECT_ACCEPTANCE',
        title: `Accept project "${project.title}"`,
        summary: `Moving to ${patch.status} is a commercial commitment and needs a second pair of eyes.`,
        entityType: 'project',
        entityId: project.id,
        leadId: project.leadId,
        payload: { requestedStatus: patch.status },
        requestedBy: actorOf(req),
      });
      res.status(202).json({
        project,
        approvalRequired: true,
        approvalId: approval.id,
        message: 'An approval was opened for this commitment. The status changes once it is approved.',
      });
      return;
    }

    res.json({ project: updateProject(req.params.id, patch, actorOf(req)), approvalRequired: false });
  }),
);
