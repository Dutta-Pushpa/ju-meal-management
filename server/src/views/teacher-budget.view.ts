import type { TeacherBudgetSummaryRow } from '../models/teacher-budget.model.js';
import type { BudgetEntryRow } from '../models/budget.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return {
    amountPaisa,
    amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}`,
  };
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthLabel(month: number): string {
  return MONTH_LABELS[Math.min(Math.max(month, 1), 12) - 1]!;
}

/** Last calendar day of a month (28-31), independent of the server time zone. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function presentTeacherBudget(
  row: TeacherBudgetSummaryRow,
  year: number,
  month: number,
) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return {
    year,
    month,
    period: {
      id: yearMonth,
      name: `${monthLabel(month)} ${year}`,
      startsOn: `${yearMonth}-01`,
      endsOn: `${yearMonth}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`,
    },
    hasAllocation: row.has_allocation,
    allocated: money(row.allocated_paisa),
    adjusted: money(row.adjusted_paisa),
    carryForward: money(row.carry_forward_paisa),
    spent: money(row.spent_paisa),
    refunded: money(row.refunded_paisa),
    available: money(row.available_paisa),
  };
}

export function presentTeacherLedgerEntry(row: BudgetEntryRow) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    budgetPeriodId: row.budget_period_id ?? null,
    entryType: row.entry_type,
    amount: money(row.amount_paisa),
    orderId: row.order_id ?? null,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
