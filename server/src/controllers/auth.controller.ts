import type { Request, Response } from 'express';
import { ROLES } from '@ju/shared';
import type { Database } from '../db/pool.js';
import {
  isValidEmail,
  login as loginService,
  logout as logoutService,
  changePassword as changePasswordService,
  resetPassword as resetPasswordService,
  registerUser,
  type AuthDeps,
  type AuthUser,
} from '../services/auth.service.js';
import { currentUser } from '../middleware/auth.js';
import { tokenFromHeader } from '../utils/token.js';
import { badRequest, forbidden, unauthorized } from '../utils/errors.js';
import { requireEnum, requireString, ValidationError } from '../utils/validation.js';
import { presentLogin, presentUser } from '../views/auth.view.js';

/**
 * Authentication controller.
 *
 * HTTP concerns only: read the request, validate it, call one service, choose a
 * status code, hand off to a view. There is no business logic here.
 */

export interface AuthControllerDeps extends AuthDeps {
  db: Database;
  jwtSecret: string;
  /** Open self-registration, allowed only outside production. */
  allowSelfRegistration: boolean;
  /** Admin key for creating ADMIN accounts (may be undefined when not configured). */
  adminKey?: string;
}

function requestMeta(req: Request): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    ipAddress: req.ip,
    userAgent: req.header('user-agent'),
  };
}

/** POST /api/auth/register */
export function register(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = req.auth;

    // In production, creating accounts is an administrative act. An open
    // registration endpoint would let anyone create a TEACHER or STAFF account.
    if (!deps.allowSelfRegistration && !actor) {
      throw unauthorized('Account creation requires an administrator.');
    }

    const fullName = requireString(readBody(req, 'fullName'), 'fullName', {
      minLength: 1,
      maxLength: 200,
    });
    const email = requireString(readBody(req, 'email'), 'email', { maxLength: 254 });
    const password = readBody(req, 'password');
    const role = requireEnum(readBody(req, 'role') ?? 'TEACHER', 'role', ROLES);
    const adminKeyInput = readBody(req, 'adminKey');
    const adminKey = typeof adminKeyInput === 'string' ? adminKeyInput : null;

    if (!isValidEmail(email)) {
      throw new ValidationError([
        { field: 'email', issue: 'invalid_format', message: 'email is not a valid address' },
      ]);
    }

    if (typeof password !== 'string') {
      throw new ValidationError([
        { field: 'password', issue: 'invalid_type', message: 'password must be a string' },
      ]);
    }

    // Public self-registration allows teacher and staff accounts. ADMIN always
    // requires the shared admin key, validated server-side by the service.
    if (!actor && role === 'ADMIN' && !adminKey) {
      throw forbidden('The admin key is required to register an administrator account.');
    }

    // A staff member with users:create may create teacher accounts, but only an
    // administrator may create another staff member or an administrator.
    if (actor && actor.role !== 'ADMIN' && role !== 'TEACHER') {
      throw badRequest('Only an administrator may create staff or admin accounts.');
    }

    const user = await registerUser(deps, { fullName, email, password, role, adminKey }, actor);

    res.status(201).json({ data: presentUser(user) });
  };
}

/** POST /api/auth/login */
export function login(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const email = requireString(readBody(req, 'email'), 'email', { maxLength: 254 });
    const password = readBody(req, 'password');
    const roleInput = readBody(req, 'role');
    const role = typeof roleInput === 'string' ? roleInput : null;

    if (typeof password !== 'string') {
      throw new ValidationError([
        { field: 'password', issue: 'invalid_type', message: 'password must be a string' },
      ]);
    }

    const result = await loginService(deps, { email, password, role }, requestMeta(req));

    res.status(200).json(presentLogin(presentUser(result.user), result.token));
  };
}

/** POST /api/auth/logout */
export function logout(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const token = tokenFromHeader(req.header('authorization'));

    if (!token) {
      throw unauthorized('An access token is required.');
    }

    await logoutService(deps.db, token, deps.jwtSecret);

    res.status(200).json({ data: { message: 'Signed out.' } });
  };
}

/** GET /api/auth/me */
export function me() {
  return (req: Request, res: Response): void => {
    const user: AuthUser = currentUser(req);

    res.status(200).json({ data: presentUser(user) });
  };
}

/** POST /api/auth/change-password */
export function changePassword(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const currentPassword = requireString(readBody(req, 'currentPassword'), 'currentPassword', {
      maxLength: 200,
    });
    const newPassword = requireString(readBody(req, 'newPassword'), 'newPassword', {
      maxLength: 200,
    });
    await changePasswordService(deps, { userId: actor.id, currentPassword, newPassword });
    res
      .status(200)
      .json({ data: { message: 'Password changed. Sign in again with your new password.' } });
  };
}
/** POST /api/auth/reset-password */
export function resetPassword(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const token = requireString(readBody(req, 'token'), 'token', { maxLength: 128 });
    const newPassword = requireString(readBody(req, 'newPassword'), 'newPassword', {
      maxLength: 200,
    });
    await resetPasswordService(deps, { token, newPassword });
    res.status(200).json({ data: { message: 'Password set. You may now sign in.' } });
  };
}
function readBody(req: Request, field: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body?.[field];
}
