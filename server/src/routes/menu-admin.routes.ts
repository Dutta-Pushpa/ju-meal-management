import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { createMenuItem, deleteMenuItem, listManagedMenuItems, updateMenuItem } from '../controllers/menu.controller.js';
import { requireAuth, requireRoleWithPermission } from '../middleware/auth.js';

export function createMenuAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = { db: deps.db, jwtSecret: deps.jwtSecret };
  const canManage = requireRoleWithPermission(['STAFF'], 'menu_items:manage');

  router.get('/', requireAuth(auth), canManage, listManagedMenuItems(deps.db));
  router.post('/', requireAuth(auth), canManage, createMenuItem(deps.db));
  router.patch('/:id', requireAuth(auth), canManage, updateMenuItem(deps.db));
  router.delete('/:id', requireAuth(auth), canManage, deleteMenuItem(deps.db));

  return router;
}
