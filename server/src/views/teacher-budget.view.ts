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

export function presentTeacherBudget(row: TeacherBudgetSummaryRow, year: number, month: number) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return {
    year,
    month,
    period: {
      id: yearMonth,
      name: `${monthLabel(month)} ${year}`,
      startsOn: `${yearMonth}-01`,
      endsOn: `${yearMonth}-31`,
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
  const reconciled = row.entry_type === 'adjustment' && /reconcil/i.test(row.reason ?? '');
  return {
    id: row.id,
    teacherId: row.teacher_id,
    budgetPeriodId: row.budget_period_id ?? null,
    entryType: row.entry_type,
    label:
      row.entry_type === 'allocation'
        ? 'Allocation'
        : row.entry_type === 'debit'
          ? 'Debit'
          : row.entry_type === 'refund'
            ? 'Refund'
            : reconciled
              ? 'Reconciliation'
              : 'Adjustment',
    amount: money(row.amount_paisa),
    runningBalance:
      row.running_balance_paisa === undefined ? null : money(row.running_balance_paisa),
    orderId: row.order_id ?? null,
    orderDate: row.order_date ?? null,
    location:
      row.location_id === null || row.location_id === undefined
        ? null
        : { id: row.location_id, name: row.location_name ?? null },
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
