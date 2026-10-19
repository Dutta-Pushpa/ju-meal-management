import { Router } from 'express';
import type { Database } from '../db/pool.js';
import {
  adjust,
  allocate,
  createPeriod,
  getBudgetLedger,
} from '../controllers/budget-admin.controller.js';
import { requireAuth, requireRoleWithPermission } from '../middleware/auth.js';

export function createBudgetAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = { db: deps.db, jwtSecret: deps.jwtSecret };
  const canAllocate = requireRoleWithPermission(['STAFF'], 'budgets:allocate');
  const canAdjust = requireRoleWithPermission(['STAFF'], 'budgets:adjust');
  const canViewBudget = requireRoleWithPermission(['STAFF'], 'budgets:view');

  router.post('/budget-periods', requireAuth(auth), canAllocate, createPeriod(deps.db));
  router.post('/budgets/allocations', requireAuth(auth), canAllocate, allocate(deps.db));
  router.post('/budgets/adjustments', requireAuth(auth), canAdjust, adjust(deps.db));
  router.get('/budgets/ledger', requireAuth(auth), canViewBudget, getBudgetLedger(deps.db));
  return router;
}
