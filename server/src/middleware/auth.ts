import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { findUserById } from '../services/users';
import { forbidden, unauthorized } from '../util/errors';
import { ROLE_RANK, type AuthUser, type Role } from '../types';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function issueToken(user: AuthUser): string {
  const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Populates `req.user` when a valid token is present. Does not reject. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    const user = findUserById(payload.sub);
    if (user && user.active) {
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    }
  } catch {
    // Invalid/expired token — treated as anonymous; `requireAuth` will reject.
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Role gate. Roles are hierarchical: admin > operator > analyst > viewer.
 * `requireRole('operator')` therefore admits operators and admins.
 */
export function requireRole(minimum: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minimum]) {
      return next(forbidden(`This action requires the "${minimum}" role or higher`));
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
/** Approvals, sending, and lead mutation require operator. */
export const requireOperator = requireRole('operator');
/** Running research/analysis requires analyst. */
export const requireAnalyst = requireRole('analyst');
