import { Router } from 'express';
import type { Database } from '../db/pool.js';
import { budgetReport, dailyReport } from '../controllers/staff-report.controller.js';
import { requireAuth, requireRole, requireRoleWithPermission } from '../middleware/auth.js';

export function createStaffReportRouter(deps: { db: Database; jwtSecret: string }): Router {
  const router = Router();
  const auth = requireAuth({ db: deps.db, jwtSecret: deps.jwtSecret });
  router.get('/reports/daily', auth, requireRole('STAFF', 'ADMIN'), dailyReport(deps.db));
  router.get(
    '/reports/budget',
    auth,
    requireRoleWithPermission(['STAFF'], 'budgets:view'),
    budgetReport(deps.db),
  );
  return router;
}
