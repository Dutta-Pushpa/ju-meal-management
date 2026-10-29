import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type Role } from '@ju/shared';
import { forbidden, unauthorized } from '../utils/errors.js';
import { tokenFromHeader } from '../utils/token.js';
import { type AuthUser, resolveToken } from '../services/auth.service.js';
import type { Queryable } from '../db/pool.js';

/**
 * Authentication and authorisation middleware.
 *
 * Authorisation is enforced here, on the server. Access is purely role-based:
 * ADMIN reaches everything, STAFF reaches the operations endpoints, and
 * TEACHER accounts are limited to their own data. Configurable per-user
 * permissions were removed from the authorisation model.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present on any request that passed requireAuth. */
      auth?: AuthUser;
    }
  }
}

export interface AuthMiddlewareDeps {
  db: Queryable;
  jwtSecret: string;
}

/**
 * Require a valid, live access token.
 *
 * On success the resolved user is attached to the request as `req.auth`.
 */
export function requireAuth(deps: AuthMiddlewareDeps): RequestHandler {
  return function authenticate(req: Request, _res: Response, next: NextFunction): void {
    const token = tokenFromHeader(req.header('authorization'));

    if (!token) {
      next(unauthorized('An access token is required.'));
      return;
    }

    resolveToken(deps.db, token, deps.jwtSecret)
      .then((user) => {
        req.auth = user;
        next();
      })
      .catch(next);
  };
}

/**
 * Resolve the user when a token is provided, but let anonymous requests pass.
 *
 * For endpoints that change behaviour based on who is calling. Open
 * self-registration is the main case: a caller with a live ADMIN token may
 * create an ADMIN account without the shared admin key, while an anonymous
 * caller still needs that key. An unusable or expired token is treated as
 * anonymous, and the route's own guards decide the outcome.
 */
export function optionalAuth(deps: AuthMiddlewareDeps): RequestHandler {
  return function authenticateOptional(req: Request, _res: Response, next: NextFunction): void {
    const token = tokenFromHeader(req.header('authorization'));

    if (!token) {
      next();
      return;
    }

    resolveToken(deps.db, token, deps.jwtSecret)
      .then((user) => {
        req.auth = user;
        next();
      })
      // A rejected or expired token does not fail the route. The request
      // proceeds anonymously, exactly as if no header had been sent.
      .catch(() => next());
  };
}

/**
 * Require one of the given roles.
 *
 * The check is allow-list based: a role not listed is refused. Refusing
 * everything unlisted is the safe default, so adding a new role does not
 * accidentally grant access to every endpoint.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  const permitted = new Set<Role>(allowed);

  return function authoriseByRole(req: Request, _res: Response, next: NextFunction): void {
    const user = req.auth;

    if (!user) {
      // Reaching here means requireAuth was not mounted before this handler.
      // Treating it as unauthenticated is safer than trusting a missing user.
      next(unauthorized('An access token is required.'));
      return;
    }

    if (!permitted.has(user.role)) {
      next(forbidden('Your role does not allow this action.'));
      return;
    }

    next();
  };
}

/** Narrowing helper for handlers that run behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.auth) {
    throw unauthorized('An access token is required.');
  }

  return req.auth;
}

// Re-exported so tests and controllers can assert against the same lists the
// middleware enforces, rather than duplicating them.
export { ROLES, PERMISSIONS } from '@ju/shared';
