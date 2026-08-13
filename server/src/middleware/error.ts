import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../util/errors';
import { log } from '../services/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      log({
        level: 'error',
        action: 'http.error',
        message: err.message,
        meta: { path: req.path, status: err.status },
      });
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  log({
    level: 'error',
    action: 'http.unhandled_error',
    message,
    meta: { path: req.path, method: req.method },
  });
  res.status(500).json({ error: { code: 'internal_error', message } });
}
