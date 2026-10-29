import { Router } from 'express';
import type { Database } from '../db/pool.js';
import {
  getBudget,
  getBudgetPeriods,
  getLedger,
} from '../controllers/teacher-budget.controller.js';
import { createRequest, listMyRequests } from '../controllers/budget-request.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createTeacherBudgetRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  const allowed = requireRole('TEACHER', 'STAFF', 'ADMIN');
  router.get('/budget-periods', auth, allowed, getBudgetPeriods(deps.db));
  router.get('/budget', auth, allowed, getBudget(deps.db));
  router.get('/budget/ledger', auth, allowed, getLedger(deps.db));
  // Budget / debt-allowance requests: teachers submit, everyone may list their own.
  router.post('/budget-requests', auth, allowed, createRequest(deps.db));
  router.get('/budget-requests', auth, allowed, listMyRequests(deps.db));
  return router;
}
