import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { requireDateQuery, requireIntQuery } from '../utils/request.js';
import { getBudgetReport, getDailyReport } from '../services/staff-report.service.js';
import { presentBudgetReport, presentDailyReport } from '../views/staff-report.view.js';

export function dailyReport(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const date = requireDateQuery(req, 'date');
    const result = await getDailyReport(db, date);
    res.status(200).json({ data: presentDailyReport(result) });
  };
}

export function budgetReport(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const periodId = requireIntQuery(req, 'period', 1, Number.MAX_SAFE_INTEGER);
    res.status(200).json(presentBudgetReport(await getBudgetReport(db, periodId)));
  };
}
