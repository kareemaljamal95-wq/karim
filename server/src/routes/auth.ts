import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { issueToken, requireAdmin, requireAuth } from '../middleware/auth';
import { createUser, listUsers, updateUser, verifyCredentials } from '../services/users';
import { asyncHandler, actorOf, currentUser } from '../util/http';
import { log } from '../services/logger';
import { ROLES, type Role } from '../types';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many login attempts. Try again shortly.' } },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = verifyCredentials(email, password);
    const token = issueToken(user);
    log({
      actorType: 'user',
      actor: user.email,
      action: 'auth.login',
      message: `${user.email} signed in`,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: currentUser(req) });
  }),
);

authRouter.get(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ items: listUsers() });
  }),
);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(ROLES as [Role, ...Role[]]),
});

authRouter.post(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = createUser(input);
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      message: `Created ${user.role} account for ${user.email}`,
    });
    res.status(201).json({ user });
  }),
);

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES as [Role, ...Role[]]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

authRouter.patch(
  '/users/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = updateUserSchema.parse(req.body);
    const user = updateUser(req.params.id, patch);
    log({
      actorType: 'user',
      actor: actorOf(req),
      action: 'user.updated',
      entityType: 'user',
      entityId: user.id,
      message: `Updated account ${user.email}`,
      meta: { fields: Object.keys(patch) },
    });
    res.json({ user });
  }),
);
