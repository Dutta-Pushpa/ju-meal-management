import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { getBudget, getLedger } from '../controllers/teacher-budget.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createTeacherBudgetRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  const allowed = requireRole('TEACHER', 'STAFF', 'ADMIN');
  router.get('/budget', auth, allowed, getBudget(deps.db));
  router.get('/budget/ledger', auth, allowed, getLedger(deps.db));
  return router;
}
