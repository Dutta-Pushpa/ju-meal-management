import { Router } from 'express';
import type { Database } from '../db/pool.js';
import {
  listActiveTeachers,
  listManagedUsers,
  patchUser,
  removeUser,
} from '../controllers/user-admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createUserAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  // User management is admin-only under the role-only access model.
  const canManage = requireRole('ADMIN');
  router.get('/users', auth, canManage, listManagedUsers(deps.db));
  router.get('/teachers', auth, requireRole('STAFF', 'ADMIN'), listActiveTeachers(deps.db));
  router.patch('/users/:id', auth, canManage, patchUser(deps.db));
  router.delete('/users/:id', auth, canManage, removeUser(deps.db));
  return router;
}
