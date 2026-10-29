import { Router } from 'express';
import type { Database } from '../db/pool.js';
import {
  adjust,
  allocate,
  createPeriod,
  getBudgetLedger,
  getHistory,
  getMonthlyBudget,
  getTransactions,
} from '../controllers/budget-admin.controller.js';
import { decideRequest, staffListRequests } from '../controllers/budget-request.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createBudgetAdminRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = { db: deps.db, jwtSecret: deps.jwtSecret };
  const canAllocate = requireRole('STAFF', 'ADMIN');
  const canAdjust = requireRole('STAFF', 'ADMIN');
  const canViewBudget = requireRole('STAFF', 'ADMIN');

  // Monthly budget planning (current model).
  router.get('/budgets/monthly', requireAuth(auth), canViewBudget, getMonthlyBudget(deps.db));
  router.post('/budgets/allocations', requireAuth(auth), canAllocate, allocate(deps.db));
  router.post('/budgets/adjustments', requireAuth(auth), canAdjust, adjust(deps.db));
  router.get('/budgets/ledger', requireAuth(auth), canViewBudget, getBudgetLedger(deps.db));
  router.get('/budgets/transactions', requireAuth(auth), canViewBudget, getTransactions(deps.db));
  router.get('/budgets/history', requireAuth(auth), canViewBudget, getHistory(deps.db));

  // Budget / debt-allowance requests: review inbox and decisions.
  router.get('/budget-requests', requireAuth(auth), canViewBudget, staffListRequests(deps.db));
  router.post(
    '/budget-requests/:id/decision',
    requireAuth(auth),
    canAdjust,
    decideRequest(deps.db),
  );

  // Legacy: budget periods are kept for historical reporting only and are no
  // longer used by the admin panel.
  router.post('/budget-periods', requireAuth(auth), canAllocate, createPeriod(deps.db));
  return router;
}
