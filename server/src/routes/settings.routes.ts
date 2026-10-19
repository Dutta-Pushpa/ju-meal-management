import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { getSettings, patchSetting } from '../controllers/settings.controller.js';
import { requireAuth, requireRoleWithPermission } from '../middleware/auth.js';

export function createSettingsRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  const manage = requireRoleWithPermission(['STAFF'], 'settings:manage');
  router.get('/settings', auth, manage, getSettings(deps.db));
  router.patch('/settings/:key', auth, manage, patchSetting(deps.db));
  return router;
}
