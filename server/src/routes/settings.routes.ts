import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { getSettings, patchSetting } from '../controllers/settings.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createSettingsRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  // Settings are administrative controls: only ADMIN may change policy.
  const admin = requireRole('ADMIN');
  router.get('/settings', auth, admin, getSettings(deps.db));
  router.patch('/settings/:key', auth, admin, patchSetting(deps.db));
  return router;
}
