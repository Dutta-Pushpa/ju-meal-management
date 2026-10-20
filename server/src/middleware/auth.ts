import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type Permission, type Role } from '@ju/shared';
import { forbidden, unauthorized } from '../utils/errors.js';
import { tokenFromHeader } from '../utils/token.js';
import { type AuthUser, resolveToken } from '../services/auth.service.js';
import type { Queryable } from '../db/pool.js';

/**
 * Authentication and authorisation middleware.
 *
 * Authorisation is enforced here, on the server. Hiding a control in the user
 * interface is presentation, not access control: anyone can call the API
 * directly.
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
 * Whether the actor holds a permission.
 *
 * ADMIN bypasses every check by design: an administrator is expected to be able
 * to reach anything. The permission list on the other roles is what enforces
 * least privilege.
 */
export function hasPermission(user: AuthUser, permission: Permission): boolean {
  return user.role === 'ADMIN' || user.permissions.includes(permission);
}

/**
 * Throw FORBIDDEN unless the actor holds the permission.
 *
 * Used by handlers that decide on a permission at runtime, where the required
 * permission depends on the request rather than on the route.
 */
export function assertPermission(user: AuthUser, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw forbidden('You do not have permission to perform this action.');
  }
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

/**
 * Require one or more permissions.
 *
 * Permission is checked before role, because the finer-grained check is the
 * one that actually expresses least privilege. A staff account can hold
 * `orders:manage_status` without holding `budgets:allocate`, and this is what
 * enforces that distinction.
 */
export function requirePermission(...required: Permission[]): RequestHandler {
  const needed = new Set<Permission>(required);

  return function authoriseByPermission(req: Request, _res: Response, next: NextFunction): void {
    const user = req.auth;

    if (!user) {
      next(unauthorized('An access token is required.'));
      return;
    }

    if (user.role === 'ADMIN') {
      next();
      return;
    }

    const held = new Set<Permission>(user.permissions);
    const missing = [...needed].filter((permission) => !held.has(permission));

    if (missing.length > 0) {
      // The names are not echoed back, because telling a caller exactly which
      // permission they lack helps them map the authorisation model.
      next(forbidden('You do not have permission to perform this action.'));
      return;
    }

    next();
  };
}

/**
 * Require a role that holds a permission, or an ADMIN.
 *
 * This expresses "staff who are allowed to do this", which is how most staff
 * endpoints read. ADMIN bypasses the check by design, since an administrator
 * is expected to be able to reach anything.
 */
export function requireRoleWithPermission(roles: Role[], permission: Permission): RequestHandler {
  return function authorise(req: Request, _res: Response, next: NextFunction): void {
    const user = req.auth;

    if (!user) {
      next(unauthorized('An access token is required.'));
      return;
    }

    if (user.role === 'ADMIN') {
      next();
      return;
    }

    if (!roles.includes(user.role)) {
      next(forbidden('Your role does not allow this action.'));
      return;
    }

    if (!hasPermission(user, permission)) {
      next(forbidden('You do not have permission to perform this action.'));
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
