import type { Request, Response } from 'express';
import { ROLES } from '@ju/shared';
import type { Database } from '../db/pool.js';
import {
  isValidEmail,
  login as loginService,
  logout as logoutService,
  registerUser,
  type AuthDeps,
  type AuthUser,
} from '../services/auth.service.js';
import { currentUser } from '../middleware/auth.js';
import { tokenFromHeader } from '../utils/token.js';
import { badRequest, unauthorized } from '../utils/errors.js';
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
    // registration endpoint would let anyone create a TEACHER, and every
    // teacher can read the budget of that account.
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

    // A teacher may not create another teacher or an admin by asking nicely.
    if (actor && actor.role !== 'ADMIN' && role !== 'TEACHER') {
      throw badRequest('Only an administrator may create staff or admin accounts.');
    }

    // Anonymous self-registration may only ever create a TEACHER. Without this
    // check, the open dev/test endpoint would mint an administrator for anyone
    // who asked for one, which is a privilege escalation rather than a
    // convenience. An administrator who wants staff accounts uses this endpoint
    // with a token, which is checked above.
    if (!actor && role !== 'TEACHER') {
      throw badRequest('Self-registration may only create teacher accounts.');
    }

    const user = await registerUser(deps, { fullName, email, password, role }, actor);

    res.status(201).json({ data: presentUser(user) });
  };
}

/** POST /api/auth/login */
export function login(deps: AuthControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const email = requireString(readBody(req, 'email'), 'email', { maxLength: 254 });
    const password = readBody(req, 'password');

    if (typeof password !== 'string') {
      throw new ValidationError([
        { field: 'password', issue: 'invalid_type', message: 'password must be a string' },
      ]);
    }

    const result = await loginService(deps, { email, password }, requestMeta(req));

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

function readBody(req: Request, field: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body?.[field];
}
