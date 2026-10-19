import type { Database } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import * as reports from '../models/staff-report.model.js';
import * as budgets from '../models/budget.model.js';

export async function getDailyReport(db: Database, date: string) {
  const totals = await reports.getDailyTotals(db, date);
  const grandTotal = totals.find((row) => row.is_total === 1);
  const locations = totals.filter((row) => row.location_id !== null);
  return { date, locations, dailyTotalPaisa: grandTotal?.total_paisa ?? 0 };
}

export async function getBudgetReport(db: Database, periodId: number) {
  if (!(await budgets.budgetPeriodExists(db, periodId))) throw notFound('Budget period not found.');
  return reports.listTeacherBudgetReport(db, periodId);
}
