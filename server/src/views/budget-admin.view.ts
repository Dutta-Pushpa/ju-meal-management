import type {
  BudgetEntryRow,
  MonthTransactionRow,
  TeacherMonthlyBalanceRow,
} from '../models/budget.model.js';
import type { BudgetHistory } from '../services/budget-admin.service.js';

function presentMoney(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return {
    amountPaisa,
    amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}`,
  };
}

export function presentBudgetEntry(entry: BudgetEntryRow) {
  const reconciled = entry.entry_type === 'adjustment' && /reconcil/i.test(entry.reason ?? '');
  return {
    id: entry.id,
    teacherId: entry.teacher_id,
    budgetPeriodId: entry.budget_period_id ?? null,
    year: entry.year ?? null,
    month: entry.month ?? null,
    entryType: entry.entry_type,
    label:
      entry.entry_type === 'allocation'
        ? 'Allocation'
        : entry.entry_type === 'debit'
          ? 'Debit'
          : entry.entry_type === 'refund'
            ? 'Refund'
            : reconciled
              ? 'Reconciliation'
              : 'Adjustment',
    amount: presentMoney(entry.amount_paisa),
    runningBalance:
      entry.running_balance_paisa === undefined ? null : presentMoney(entry.running_balance_paisa),
    orderId: entry.order_id ?? null,
    orderDate: 'order_date' in entry ? entry.order_date : null,
    location:
      'location_id' in entry && entry.location_id !== null
        ? { id: entry.location_id, name: entry.location_name }
        : null,
    reason: entry.reason,
    createdBy: entry.created_by,
    createdAt: entry.created_at.toISOString(),
  };
}

export function presentAllocation(result: {
  allocation: { id: number; teacherId: number; amountPaisa: number; year: number; month: number };
  ledgerEntry: BudgetEntryRow;
}) {
  return {
    allocation: {
      id: result.allocation.id,
      teacherId: result.allocation.teacherId,
      year: result.allocation.year,
      month: result.allocation.month,
      amount: presentMoney(result.allocation.amountPaisa),
    },
    ledgerEntry: presentBudgetEntry(result.ledgerEntry),
  };
}

export function presentMonthlyBudgetRow(row: TeacherMonthlyBalanceRow) {
  return {
    teacher: { id: row.teacher_id, fullName: row.teacher_name, email: row.email },
    hasAllocation: row.has_allocation,
    allocated: presentMoney(row.allocated_paisa),
    adjusted: presentMoney(row.adjusted_paisa),
    carryForward: presentMoney(row.carry_forward_paisa),
    spent: presentMoney(row.spent_paisa),
    refunded: presentMoney(row.refunded_paisa),
    remaining: presentMoney(row.available_paisa),
  };
}

export function presentMonthlyBudgetRows(rows: TeacherMonthlyBalanceRow[]) {
  return {
    data: rows.map(presentMonthlyBudgetRow),
    meta: { total: rows.length },
  };
}

/** Transaction id shown to users, derived from the order id. */
export function formatTransactionId(orderId: number): string {
  return `TXN-${String(orderId).padStart(6, '0')}`;
}

export function presentMonthTransaction(row: MonthTransactionRow) {
  return {
    id: row.id,
    transactionId: formatTransactionId(row.id),
    teacher: { id: row.teacher_id, fullName: row.teacher_name },
    orderDate: row.order_date,
    amount: presentMoney(row.total_paisa),
    status: row.status,
  };
}

export function presentMonthTransactions(rows: MonthTransactionRow[]) {
  return { data: rows.map(presentMonthTransaction) };
}

export function presentBudgetHistory(history: BudgetHistory) {
  return {
    anchor: history.anchor,
    months: history.months.map((month) => ({
      year: month.year,
      month: month.month,
      label: month.label,
      totalAllocated: presentMoney(month.totalAllocatedPaisa),
      teachers: month.teachers.map((teacher) => ({
        teacherId: teacher.teacherId,
        fullName: teacher.teacherName,
        allocated: presentMoney(teacher.allocatedPaisa),
      })),
    })),
    grandTotal: presentMoney(history.grandTotalPaisa),
  };
}
