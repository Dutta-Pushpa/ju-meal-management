import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ApiErrorResponse } from '@ju/shared';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import {
  login,
  logout,
  me,
  register,
  type AuthControllerDeps,
} from '../controllers/auth.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/**
 * Authentication routes.
 */
export function createAuthRouter(deps: {
  db: Database;
  config: AppConfig;
  allowSelfRegistration: boolean;
}): Router {
  const router = Router();

  const controllerDeps: AuthControllerDeps = {
    db: deps.db,
    jwtSecret: deps.config.JWT_SECRET,
    tokenLifetimeMinutes: deps.config.JWT_EXPIRES_IN_MINUTES,
    bcryptCost: deps.config.BCRYPT_COST,
    allowSelfRegistration: deps.allowSelfRegistration,
  };

  const auth = { db: deps.db, jwtSecret: deps.config.JWT_SECRET };

  /**
   * A much tighter limit than the global one, and keyed on both the client
   * address and the submitted email.
   *
   * Keying on the address alone would let one attacker lock every account out
   * of signing in. Keying on the email alone would let a determined attacker
   * block an account from elsewhere.
   */
  const loginLimiter = rateLimit({
    windowMs: deps.config.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: deps.config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.toLowerCase() : '';

      // ipKeyGenerator normalises IPv6 into a /64 subnet, which is required so
      // one client cannot rotate addresses to reset the limit.
      return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
    },
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many sign-in attempts. Please wait before trying again.',
      },
    } satisfies ApiErrorResponse,
  });

  router.post('/register', register(controllerDeps));
  router.post('/login', loginLimiter, login(controllerDeps));
  router.post('/logout', requireAuth(auth), logout(controllerDeps));

  router.get('/me', requireAuth(auth), me());

  /**
   * A deliberate, minimal probe that exercises the role guard without needing a
   * business feature to exist yet. It reveals nothing about the database and is
   * replaced by real staff endpoints in the next phase.
   */
  router.get('/staff-check', requireAuth(auth), requireRole('STAFF', 'ADMIN'), (_req, res) => {
    res.status(200).json({ data: { allowed: true } });
  });

  return router;
}
