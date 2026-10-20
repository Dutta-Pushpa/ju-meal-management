import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { conflict, notFound } from '../utils/errors.js';
import { isExclusionViolation, isUniqueViolation } from '../utils/pg-errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as budget from '../models/budget.model.js';
import * as teacherBudget from '../models/teacher-budget.model.js';
import { lockActiveTeacher } from '../models/user.model.js';

export async function createBudgetPeriod(
  db: Database,
  input: { name: string; startsOn: string; endsOn: string },
  actorUserId: number,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const period = await budget.insertPeriod(tx, input);
      let rolledOverTeachers = 0;
      let rolledOverAmountPaisa = 0;
      if (await budget.budgetRolloverEnabled(tx)) {
        const balances = await budget.listRolloverBalances(tx, input.startsOn);
        for (const balance of balances) {
          await budget.insertAdjustment(tx, {
            teacherId: balance.teacher_id,
            periodId: period.id,
            amountPaisa: balance.amount_paisa,
            actorUserId,
            reason: `Budget rollover from ${balance.source_period_name}`,
          });
          rolledOverTeachers += 1;
          rolledOverAmountPaisa += balance.amount_paisa;
        }
      }
      await writeAudit(tx, {
        actorUserId,
        action: 'budget.period.created',
        entityType: 'budget_period',
        entityId: period.id,
        metadata: {
          name: period.name,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          rolledOverTeachers,
          rolledOverAmountPaisa,
        },
      });
      return { ...period, rolledOverTeachers, rolledOverAmountPaisa };
    });
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw conflict('BUDGET_PERIOD_ALREADY_EXISTS', 'Budget periods cannot overlap.');
    }
    if (isUniqueViolation(error)) {
      throw conflict(
        'BUDGET_PERIOD_ALREADY_EXISTS',
        'A budget period with that name already exists.',
      );
    }
    throw error;
  }
}

export async function allocateBudget(
  db: Database,
  input: {
    teacherId: number;
    periodId: number;
    amountPaisa: number;
    reason: string;
    actorUserId: number;
  },
) {
  try {
    return await withTransaction(db, async (tx) => {
      if (!(await lockActiveTeacher(tx, input.teacherId))) {
        throw notFound('No active teacher with that id.');
      }
      if (!(await budget.findActivePeriod(tx, input.periodId))) {
        throw notFound('No active budget period with that id.');
      }
      const result = await budget.insertAllocation(tx, {
        teacherId: input.teacherId,
        periodId: input.periodId,
        amountPaisa: input.amountPaisa,
        actorUserId: input.actorUserId,
        reason: input.reason,
      });
      await writeAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'budget.allocation.created',
        entityType: 'budget_allocation',
        entityId: result.allocationId,
        metadata: {
          teacherId: input.teacherId,
          budgetPeriodId: input.periodId,
          amountPaisa: input.amountPaisa,
        },
      });
      return {
        allocation: {
          id: result.allocationId,
          teacherId: input.teacherId,
          budgetPeriodId: input.periodId,
          amountPaisa: input.amountPaisa,
        },
        ledgerEntry: result.entry,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        'DUPLICATE_ALLOCATION',
        'The teacher already has an allocation for this period.',
      );
    }
    throw error;
  }
}

export async function adjustBudget(
  db: Database,
  input: {
    teacherId: number;
    periodId: number;
    amountPaisa: number;
    reason: string;
    actorUserId: number;
  },
) {
  return withTransaction(db, async (tx) => {
    if (!(await lockActiveTeacher(tx, input.teacherId))) {
      throw notFound('No active teacher with that id.');
    }
    if (!(await budget.findActivePeriod(tx, input.periodId))) {
      throw notFound('No active budget period with that id.');
    }
    const entry = await budget.insertAdjustment(tx, {
      teacherId: input.teacherId,
      periodId: input.periodId,
      amountPaisa: input.amountPaisa,
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'budget.adjustment.created',
      entityType: 'budget_ledger',
      entityId: entry.id,
      metadata: {
        teacherId: input.teacherId,
        budgetPeriodId: input.periodId,
        amountPaisa: input.amountPaisa,
      },
    });
    return entry;
  });
}

export async function getBudgetLedger(
  db: Database,
  teacherId: number,
  periodId: number,
  page: number,
  perPage: number,
) {
  if (!(await budget.teacherExists(db, teacherId))) throw notFound('Teacher not found.');
  if (!(await budget.budgetPeriodExists(db, periodId))) throw notFound('Budget period not found.');
  const total = await teacherBudget.countLedgerEntries(db, teacherId, periodId);
  const entries = await teacherBudget.listLedgerEntries(
    db,
    teacherId,
    periodId,
    perPage,
    (page - 1) * perPage,
  );
  return { entries, total };
}
