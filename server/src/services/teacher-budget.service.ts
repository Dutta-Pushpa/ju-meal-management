import type { Queryable } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import * as budgets from '../models/teacher-budget.model.js';
import type { LedgerFilters } from '../models/budget.model.js';

/** Teachers always receive a summary row (zeros when they have not been
 * allocated yet), so the UI can show a friendly "no allocation yet" state. */
export async function getTeacherBudget(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
) {
  const summary = await budgets.findBudgetSummary(db, teacherId, year, month);
  if (!summary) throw notFound('Teacher record not found.');
  return summary;
}

export async function getTeacherLedger(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
  page: number,
  perPage: number,
  filters: LedgerFilters = {},
) {
  const total = await budgets.countLedgerEntries(db, teacherId, year, month, filters);
  const entries = await budgets.listLedgerEntries(
    db,
    teacherId,
    year,
    month,
    perPage,
    (page - 1) * perPage,
    filters,
  );
  return { entries, total };
}
