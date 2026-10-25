import type { Queryable } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import * as budgets from '../models/teacher-budget.model.js';

export async function getTeacherBudget(db: Queryable, teacherId: number, year: number, month: number) {
  const summary = await budgets.findBudgetSummary(db, teacherId, year * 100 + month);
  if (!summary) throw notFound('No monthly budget allocation found.');
  return summary;
}

export async function getTeacherLedger(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
  page: number,
  perPage: number,
) {
  const summary = await budgets.findBudgetSummary(db, teacherId, year * 100 + month);
  if (!summary) throw notFound('No monthly budget allocation found.');
  const total = await budgets.countLedgerEntries(db, teacherId, year, month);
  const entries = await budgets.listLedgerEntries(
    db,
    teacherId,
    year,
    month,
    perPage,
    (page - 1) * perPage,
  );
  return { entries, total };
}
