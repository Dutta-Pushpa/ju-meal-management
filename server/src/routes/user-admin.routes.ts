import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { ApiErrorResponse } from '@ju/shared';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import {
  issuePasswordResetController,
  listActiveTeachers,
  listManagedUsers,
  patchUser,
  removeUser,
} from '../controllers/user-admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createUserAdminRouter(deps: { db: Database; config: AppConfig }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.config.JWT_SECRET });
  const canManage = requireRole('ADMIN');
  const resetLimiter = rateLimit({
    windowMs: deps.config.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many password reset requests. Please wait before trying again.',
      },
    } satisfies ApiErrorResponse,
  });
  const passwordDeps = {
    db: deps.db,
    jwtSecret: deps.config.JWT_SECRET,
    tokenLifetimeMinutes: deps.config.JWT_EXPIRES_IN_MINUTES,
    bcryptCost: deps.config.BCRYPT_COST,
  };
  router.get('/users', auth, canManage, listManagedUsers(deps.db));
  router.get('/teachers', auth, requireRole('STAFF', 'ADMIN'), listActiveTeachers(deps.db));
  router.post(
    '/users/:id/password-reset',
    resetLimiter,
    auth,
    canManage,
    issuePasswordResetController(passwordDeps),
  );
  router.patch('/users/:id', auth, canManage, patchUser(deps.db));
  router.delete('/users/:id', auth, canManage, removeUser(deps.db));
  return router;
}
