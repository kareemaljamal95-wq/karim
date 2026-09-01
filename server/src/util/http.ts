import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { unauthorized } from './errors';
import type { AuthUser } from '../types';

/** Wraps an async route so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Actor label used in audit-log entries. */
export const actorOf = (req: Request): string => req.user?.email ?? 'system';

export const parseIntOr = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseBool = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (['1', 'true', 'yes'].includes(text)) return true;
  if (['0', 'false', 'no'].includes(text)) return false;
  return undefined;
};
