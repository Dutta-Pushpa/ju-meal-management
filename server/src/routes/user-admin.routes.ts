import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { patchUser } from '../controllers/user-admin.controller.js';
import { requireAuth, requireRoleWithPermission } from '../middleware/auth.js';

export function createUserAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  router.patch(
    '/users/:id',
    requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret }),
    requireRoleWithPermission(['STAFF'], 'users:manage'),
    patchUser(deps.db),
  );
  return router;
}
