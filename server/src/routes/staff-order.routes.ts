import { Router } from 'express';
import type { Database } from '../db/pool.js';
import type { AppConfig } from '../config/env.js';
import {
  groupedStaffOrders,
  listStaffOrders,
  patchStaffOrderItemStatus,
  patchStaffOrderStatus,
} from '../controllers/staff-order.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createStaffOrderRouter(deps: { db: Database; config: AppConfig }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.config.JWT_SECRET });
  const staff = requireRole('STAFF', 'ADMIN');
  router.get('/orders/grouped', auth, staff, groupedStaffOrders(deps.db));
  router.get('/orders', auth, staff, listStaffOrders(deps.db));
  router.patch('/orders/:id/status', auth, staff, patchStaffOrderStatus(deps));
  router.patch('/order-items/:id/status', auth, staff, patchStaffOrderItemStatus(deps.db));
  return router;
}
