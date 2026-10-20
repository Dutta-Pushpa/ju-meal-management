import type { TeacherBudgetSummaryRow, TeacherLedgerRow } from '../models/teacher-budget.model.js';
import { presentMoney } from '../utils/money.js';

export function presentTeacherBudget(row: TeacherBudgetSummaryRow) {
  return {
    period: {
      id: row.period_id,
      name: row.period_name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
    },
    allocated: presentMoney(row.allocated_paisa),
    spent: presentMoney(row.spent_paisa),
    refunded: presentMoney(row.refunded_paisa),
    adjusted: presentMoney(row.adjusted_paisa),
    available: presentMoney(row.available_paisa),
  };
}

export function presentTeacherLedgerEntry(row: TeacherLedgerRow) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    budgetPeriodId: row.budget_period_id,
    entryType: row.entry_type,
    amount: presentMoney(row.amount_paisa),
    orderId: row.order_id,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
