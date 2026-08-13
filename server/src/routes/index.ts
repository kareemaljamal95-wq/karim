import { Router } from 'express';
import { authRouter } from './auth';
import { leadsRouter } from './leads';
import { researchRouter } from './research';
import { messagesRouter } from './messages';
import { approvalsRouter } from './approvals';
import { agentsRouter } from './agents';
import { workflowsRouter } from './workflows';
import { projectsRouter } from './projects';
import { conversationsRouter } from './conversations';
import { systemRouter } from './system';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/leads', leadsRouter);
apiRouter.use('/research', researchRouter);
apiRouter.use('/messages', messagesRouter);
apiRouter.use('/approvals', approvalsRouter);
apiRouter.use('/agents', agentsRouter);
apiRouter.use('/workflows', workflowsRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/system', systemRouter);
