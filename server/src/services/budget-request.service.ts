import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as requests from '../models/budget-request.model.js';
import * as budget from '../models/budget.model.js';
import { currentDhakaMonth } from '../utils/dhaka-month.js';

export type BudgetRequestType = 'budget_increase' | 'debt_allowance';

export async function createBudgetRequest(
  db: Database,
  input: {
    teacherId: number;
    requestType: BudgetRequestType;
    amountPaisa: number;
    reason: string;
  },
) {
  if (!Number.isSafeInteger(input.amountPaisa) || input.amountPaisa <= 0) {
    throw badRequest('amountPaisa must be a positive integer amount in paisa.');
  }
  const id = await requests.insertBudgetRequest(db, input);
  await writeAudit(db, {
    actorUserId: input.teacherId,
    action: 'budget.request.created',
    entityType: 'budget_request',
    entityId: id,
    metadata: {
      requestType: input.requestType,
      amountPaisa: input.amountPaisa,
      reason: input.reason,
    },
  });
  const row = await requests.findBudgetRequest(db, id);
  if (!row) throw notFound('Budget request not found after creation.');
  return row;
}

export async function listBudgetRequests(
  db: Database,
  filters: { teacherId?: number | undefined; status?: string | undefined },
  page: number,
  perPage: number,
) {
  const total = await requests.countBudgetRequests(db, filters);
  const rows = await requests.listBudgetRequests(db, filters, perPage, (page - 1) * perPage);
  return { rows, total };
}

/**
 * Approve or reject a pending budget request. An approved budget_increase adds
 * the amount to the teacher's current Dhaka month budget as an adjustment
 * ledger entry; an approved debt_allowance raises the teacher's personal debt
 * headroom on top of the global policy.
 */
export async function decideBudgetRequest(
  db: Database,
  input: {
    requestId: number;
    decision: 'approved' | 'rejected';
    note: string | undefined;
    actorUserId: number;
  },
) {
  const existing = await requests.findBudgetRequest(db, input.requestId);
  if (!existing) throw notFound('Budget request not found.');
  if (existing.status !== 'pending') {
    throw badRequest(`This request was already ${existing.status}.`);
  }

  return withTransaction(db, async (tx) => {
    const decided = await requests.decideBudgetRequest(tx, input.requestId, {
      status: input.decision,
      decidedBy: input.actorUserId,
    });
    if (!decided) throw badRequest('This request was already decided.');

    let ledgerEntryId: number | undefined;
    let newDebtAllowancePaisa: number | undefined;
    if (input.decision === 'approved') {
      if (existing.request_type === 'budget_increase') {
        const { year, month } = currentDhakaMonth();
        const entry = await budget.insertAdjustment(tx, {
          teacherId: existing.teacher_id,
          year,
          month,
          amountPaisa: Number(existing.amount_paisa),
          actorUserId: input.actorUserId,
          reason: `Budget request #${existing.id} approved${input.note ? `: ${input.note}` : ''}`,
        });
        ledgerEntryId = entry.id;
        await writeAudit(tx, {
          actorUserId: input.actorUserId,
          action: 'budget.monthly.adjusted',
          entityType: 'budget_ledger',
          entityId: entry.id,
          metadata: {
            teacherId: existing.teacher_id,
            year,
            month,
            amountPaisa: Number(existing.amount_paisa),
            budgetRequestId: existing.id,
          },
        });
      } else {
        newDebtAllowancePaisa = await requests.addDebtAllowance(
          tx,
          existing.teacher_id,
          Number(existing.amount_paisa),
        );
      }
    }

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'budget.request.decided',
      entityType: 'budget_request',
      entityId: input.requestId,
      metadata: {
        decision: input.decision,
        requestType: existing.request_type,
        amountPaisa: Number(existing.amount_paisa),
        teacherId: existing.teacher_id,
        note: input.note ?? null,
      },
    });

    const row = await requests.findBudgetRequest(tx, input.requestId);
    if (!row) throw notFound('Budget request not found after decision.');
    return { request: row, ledgerEntryId, newDebtAllowancePaisa };
  });
}
