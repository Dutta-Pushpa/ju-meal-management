import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/pool.js';
import {
  cancelOrder,
  createOrder,
  getMyOrderById,
  listMyOrders,
} from '../controllers/order.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createOrderRouter(deps: { db: Database; config: AppConfig }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.config.JWT_SECRET });
  router.post(
    '/',
    auth,
    requireRole('TEACHER'),
    createOrder({ db: deps.db }),
  );
  router.get('/mine', auth, requireRole('TEACHER'), listMyOrders(deps.db));
  router.get('/mine/:id', auth, requireRole('TEACHER'), getMyOrderById(deps.db));
  router.post('/:id/cancel', auth, cancelOrder({ db: deps.db }));
  return router;
}
