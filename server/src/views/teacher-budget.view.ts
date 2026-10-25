import type { TeacherBudgetSummaryRow } from '../models/teacher-budget.model.js';
import type { BudgetEntryRow } from '../models/budget.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return {
    amountPaisa,
    amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}`,
  };
}

export function presentTeacherBudget(row: TeacherBudgetSummaryRow) {
  return {
    period: {
      id: row.period_id,
      name: row.period_name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
    },
    allocated: money(row.allocated_paisa),
    spent: money(row.spent_paisa),
    refunded: money(row.refunded_paisa),
    adjusted: money(row.adjusted_paisa),
    available: money(row.available_paisa),
  };
}

export function presentTeacherLedgerEntry(row: BudgetEntryRow) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    budgetPeriodId: row.budget_period_id,
    entryType: row.entry_type,
    amount: money(row.amount_paisa),
    orderId: row.order_id ?? null,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
