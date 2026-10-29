import type { Queryable } from '../db/pool.js';
import * as budgets from '../models/budget.model.js';
import type { TeacherMonthlyBalanceRow } from '../models/budget.model.js';

export type { TeacherMonthlyBalanceRow };

export type TeacherBudgetSummaryRow = TeacherMonthlyBalanceRow;

/** Monthly budget summary for a teacher (with carry-forward from prior months). */
export async function findBudgetSummary(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
): Promise<TeacherBudgetSummaryRow | undefined> {
  return budgets.findTeacherMonthlyBalance(db, teacherId, year, month);
}

export { countLedgerEntries, listLedgerEntries } from '../models/budget.model.js';
