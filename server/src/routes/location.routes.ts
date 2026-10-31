import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  listAllManagedLocations,
  updateLocation,
  type LocationControllerDeps,
} from '../controllers/location.controller.js';
import { getMenu } from '../controllers/menu.controller.js';

/**
 * Food-location routes.
 *
 * Reading is open to any signed-in user. Creating, updating, and deactivating
 * are operational: ADMIN, or STAFF (role-only access control).
 */
export const TIMEZONE = 'Asia/Dhaka';

export function createLocationRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();

  const auth = { db: deps.db, jwtSecret: deps.jwtSecret };
  const controllerDeps: LocationControllerDeps = {
    db: deps.db,
    timezone: TIMEZONE,
  };

  const canManage = requireRole('STAFF', 'ADMIN');

  router.get('/', requireAuth(auth), listLocations(controllerDeps));
  router.get('/manage/all', requireAuth(auth), canManage, listAllManagedLocations(controllerDeps));
  router.get('/:id', requireAuth(auth), getLocation(controllerDeps));
  router.get('/:id/menu', requireAuth(auth), getMenu(deps.db));
  router.post('/', requireAuth(auth), canManage, createLocation(controllerDeps));
  router.patch('/:id', requireAuth(auth), canManage, updateLocation(controllerDeps));
  router.delete('/:id', requireAuth(auth), canManage, deleteLocation(controllerDeps));

  return router;
}
