import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';
import { requireInt, requireString } from '../utils/validation.js';
import {
  getBudgetReport,
  getDailyReport,
  getMonthlyTeacherReport,
} from '../services/staff-report.service.js';
import {
  presentBudgetReport,
  presentDailyReport,
  presentMonthlyTeacherReport,
} from '../views/staff-report.view.js';
import { readYearMonth } from './budget-admin.controller.js';

export function dailyReport(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const date = readBusinessDate(req.query['date']);
    const result = await getDailyReport(db, date);
    res.status(200).json({ data: presentDailyReport(result) });
  };
}

export function budgetReport(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawPeriod = req.query['period'];
    if (typeof rawPeriod !== 'string' || !/^\d+$/.test(rawPeriod)) {
      throw badRequest('period must be a positive integer.');
    }
    const periodId = requireInt(Number(rawPeriod), 'period', {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    res.status(200).json(presentBudgetReport(await getBudgetReport(db, periodId)));
  };
}

/** GET /staff/reports/monthly?year&month — six-month per-teacher report. */
export function monthlyReport(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const { year, month } = readYearMonth(req.query);
    const months = await getMonthlyTeacherReport(db, year, month);
    res.status(200).json({ data: presentMonthlyTeacherReport(months) });
  };
}

function readBusinessDate(value: unknown): string {
  const date = requireString(value, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('date must be a valid date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest('date must be a valid date in YYYY-MM-DD format.');
  }
  return date;
}
