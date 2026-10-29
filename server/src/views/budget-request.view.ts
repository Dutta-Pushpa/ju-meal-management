import type { BudgetRequestRow } from '../models/budget-request.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return { amountPaisa, amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}` };
}

export function presentBudgetRequest(row: BudgetRequestRow) {
  return {
    id: row.id,
    teacher: { id: row.teacher_id, fullName: row.teacher_name },
    requestType: row.request_type,
    amount: money(Number(row.amount_paisa)),
    reason: row.reason,
    status: row.status,
    decidedBy: row.decided_by ? { id: row.decided_by, fullName: row.decided_by_name } : null,
    decidedAt: row.decided_at ? row.decided_at : null,
    createdAt: row.created_at,
  };
}
