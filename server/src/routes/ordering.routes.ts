import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { getOrderingStatus } from '../controllers/ordering.controller.js';
import { requireAuth } from '../middleware/auth.js';

export function createOrderingRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  router.get(
    '/status',
    requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret }),
    getOrderingStatus(deps.db),
  );
  return router;
}
