import type { Queryable } from '../db/pool.js';
import * as budgets from '../models/budget.model.js';

export interface TeacherBudgetSummaryRow {
  period_id: number;
  period_name: string;
  starts_on: string;
  ends_on: string;
  allocated_paisa: number;
  spent_paisa: number;
  refunded_paisa: number;
  adjusted_paisa: number;
  available_paisa: number;
}

export interface TeacherLedgerRow {
  id: number;
  teacher_id: number;
  budget_period_id: number;
  entry_type: 'allocation' | 'debit' | 'refund' | 'adjustment';
  amount_paisa: number;
  order_id: number | null;
  reason: string | null;
  created_by: number;
  created_at: Date;
}

/** Monthly budget summary for a teacher. */
export async function findBudgetSummary(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<TeacherBudgetSummaryRow | undefined> {
  // Extract year and month from period_id (periodId format: YYYYMM) or find the period
  const year = Math.floor(periodId / 100);
  const month = periodId % 100;
  const summary = await budgets.findMonthlyAllocationSummary(db, teacherId, year, month);
  if (!summary) return undefined;
  return {
    period_id: periodId,
    period_name: `Monthly ${summary.allocated_paisa_raw > 0 ? summary.allocated_paisa_raw : ''}`,
    starts_on: '0000-01-01',
    ends_on: '0000-12-31',
    allocated_paisa: summary.allocated_paisa,
    spent_paisa: summary.spent_paisa,
    refunded_paisa: summary.refunded_paisa,
    adjusted_paisa: summary.adjusted_paisa,
    available_paisa: summary.available_paisa,
  };
}

export { countLedgerEntries, listLedgerEntries } from '../models/budget.model.js';
