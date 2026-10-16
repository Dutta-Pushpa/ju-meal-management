import type { NextFunction, Request, Response } from 'express';
import { notFound } from '../utils/errors.js';

/**
 * Catch-all for any path no router claimed.
 *
 * `notFound` throws an AppError, which the error handler formats, so an unknown
 * route produces the same error envelope as every other failure rather than an
 * HTML error page from Express.
 */
export function routeNotFound() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next(notFound(`No route matches ${req.method} ${req.path}.`));
  };
}
