import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
} from '../services/workflows';
import { validateDefinition, type WorkflowDefinition } from '../orchestrator/workflowTypes';
import { listAgents } from '../agents/registry';
import { listTools } from '../tools/registry';
import { actorOf, asyncHandler } from '../util/http';
import { log } from '../services/logger';

export const workflowsRouter = Router();

workflowsRouter.use(requireAuth);

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['trigger', 'agent', 'tool', 'condition', 'approval', 'action']),
  label: z.string().min(1),
  agent: z.string().optional(),
  tool: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const definitionSchema = z.object({
  nodes: z.array(nodeSchema).min(1),
  edges: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      when: z.enum(['pass', 'fail']).optional(),
    }),
  ),
});

workflowsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      items: listWorkflows(),
      // Everything the builder needs to offer valid node choices.
      palette: {
        agents: listAgents().map((a) => ({ key: a.key, name: a.name, enabled: a.enabled })),
        tools: listTools(),
        nodeTypes: ['trigger', 'agent', 'tool', 'condition', 'approval', 'action'],
        conditionFields: [
          'leadScore',
          'opportunityScore',
          'grade',
          'estimatedValue',
          'confidence',
          'hasEmail',
          'hasPhone',
          'recommendedService',
        ],
        actions: ['save_leads', 'send_after_approval', 'notify'],
        approvalKinds: [
          'FIRST_OUTREACH',
          'COMMERCIAL_COMMITMENT',
          'PRICE_AGREEMENT',
          'PROJECT_ACCEPTANCE',
          'DELIVERABLE_SEND',
          'IRREVERSIBLE_ACTION',
        ],
      },
    });
  }),
);

workflowsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ workflow: getWorkflow(req.params.id) });
  }),
);

workflowsRouter.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const definition = definitionSchema.parse(req.body) as WorkflowDefinition;
    const problems = validateDefinition(definition);
    res.json({ valid: problems.length === 0, problems });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: definitionSchema,
});

workflowsRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const workflow = createWorkflow({
      name: input.name,
      description: input.description,
      definition: input.definition as WorkflowDefinition,
    });
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'workflow.created',
      entityType: 'workflow',
      entityId: workflow.id,
      message: `Workflow "${workflow.name}" created`,
    });
    res.status(201).json({ workflow });
  }),
);

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  definition: definitionSchema.optional(),
  enabled: z.boolean().optional(),
});

workflowsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const workflow = updateWorkflow(req.params.id, {
      ...patch,
      definition: patch.definition as WorkflowDefinition | undefined,
    });
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'workflow.updated',
      entityType: 'workflow',
      entityId: workflow.id,
      message: `Workflow "${workflow.name}" updated`,
    });
    res.json({ workflow });
  }),
);

workflowsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    deleteWorkflow(req.params.id);
    res.status(204).end();
  }),
);
