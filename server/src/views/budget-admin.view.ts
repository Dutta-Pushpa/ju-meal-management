import type { BudgetEntryRow } from '../models/budget.model.js';
import { presentMoney } from '../utils/money.js';

export function presentBudgetEntry(entry: BudgetEntryRow) {
  return {
    id: entry.id,
    teacherId: entry.teacher_id,
    budgetPeriodId: entry.budget_period_id,
    entryType: entry.entry_type,
    amount: presentMoney(entry.amount_paisa),
    orderId: entry.order_id ?? null,
    reason: entry.reason,
    createdBy: entry.created_by,
    createdAt: entry.created_at.toISOString(),
  };
}

export function presentAllocation(result: {
  allocation: { id: number; teacherId: number; budgetPeriodId: number; amountPaisa: number };
  ledgerEntry: BudgetEntryRow;
}) {
  return {
    allocation: {
      id: result.allocation.id,
      teacherId: result.allocation.teacherId,
      budgetPeriodId: result.allocation.budgetPeriodId,
      amount: presentMoney(result.allocation.amountPaisa),
    },
    ledgerEntry: presentBudgetEntry(result.ledgerEntry),
  };
}
