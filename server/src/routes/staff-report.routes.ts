import { Router } from 'express';
import type { Database } from '../db/pool.js';
import {
  budgetReport,
  dailyReport,
  monthlyReport,
} from '../controllers/staff-report.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function createStaffReportRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  const canViewBudget = requireRole('STAFF', 'ADMIN');
  router.get('/reports/daily', auth, canViewBudget, dailyReport(deps.db));
  router.get('/reports/monthly', auth, canViewBudget, monthlyReport(deps.db));
  router.get('/reports/budget', auth, canViewBudget, budgetReport(deps.db));
  return router;
}
