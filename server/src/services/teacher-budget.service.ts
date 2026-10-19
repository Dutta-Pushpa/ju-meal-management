import type { Queryable } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import * as budgets from '../models/teacher-budget.model.js';

export async function getTeacherBudget(db: Queryable, teacherId: number, periodId: number) {
  const summary = await budgets.findBudgetSummary(db, teacherId, periodId);
  if (!summary) throw notFound('Budget period not found.');
  return summary;
}

export async function getTeacherLedger(
  db: Queryable,
  teacherId: number,
  periodId: number,
  page: number,
  perPage: number,
) {
  const summary = await budgets.findBudgetSummary(db, teacherId, periodId);
  if (!summary) throw notFound('Budget period not found.');
  const total = await budgets.countLedgerEntries(db, teacherId, periodId);
  const entries = await budgets.listLedgerEntries(
    db,
    teacherId,
    periodId,
    perPage,
    (page - 1) * perPage,
  );
  return { entries, total };
}
