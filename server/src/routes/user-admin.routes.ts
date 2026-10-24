import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { listActiveTeachers, listManagedUsers, patchUser } from '../controllers/user-admin.controller.js';
import { requireAuth, requireRoleWithPermission } from '../middleware/auth.js';
import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../utils/errors.js';

export function createUserAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  const canManage = requireRoleWithPermission(['STAFF'], 'users:manage');
  router.get('/users', auth, canManage, listManagedUsers(deps.db));
  router.get('/teachers', auth, canAccessBudgetTeacherDirectory, listActiveTeachers(deps.db));
  router.patch(
    '/users/:id',
    auth,
    canManage,
    patchUser(deps.db),
  );
  return router;
}


/** Permit teacher choices to staff who can view, allocate, or adjust budgets, and admins. */
function canAccessBudgetTeacherDirectory(req: Request, _res: Response, next: NextFunction): void {
  const actor = req.auth;
  if (!actor) {
    next(unauthorized('Authentication is required.'));
    return;
  }
  if (actor.role === 'ADMIN' || (actor.role === 'STAFF' && (
    actor.permissions.includes('budgets:allocate') || actor.permissions.includes('budgets:view') || actor.permissions.includes('budgets:adjust')
  ))) {
    next();
    return;
  }
  next(forbidden('You do not have permission to view budget teacher choices.'));
}
