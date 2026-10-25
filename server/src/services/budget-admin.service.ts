import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { conflict, notFound } from '../utils/errors.js';
import { isExclusionViolation, isUniqueViolation } from '../utils/pg-errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as budget from '../models/budget.model.js';
import { TIMEZONE } from '../routes/location.routes.js';

export async function createBudgetPeriod(
  db: Database,
  input: { name: string; startsOn: string; endsOn: string },
  actorUserId: number,
) {
  try {
    return await withTransaction(db, async (tx) => {
      const period = await budget.insertPeriod(tx, input);
      await writeAudit(tx, {
        actorUserId,
        action: 'budget.period.created',
        entityType: 'budget_period',
        entityId: period.id,
        metadata: {
          name: period.name,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          rolledOverBalance: await budget.listRolloverBalances(tx, TIMEZONE),
          
        },
      });
      return { ...period, rolledOverBalance: await budget.listRolloverBalances(tx, TIMEZONE) };
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
    year: number;
    month: number;
    amountPaisa: number;
    reason: string;
    actorUserId: number;
  },
) {
  try {
    return await withTransaction(db, async (tx) => {
      if (!(await budget.findTeacher(tx, input.teacherId))) {
        throw notFound('No active teacher with that id.');
      }
      if (!(await budget.teacherExists(tx, input.teacherId))) {
        throw notFound('No active teacher with that id.');
      }
      const result = await budget.insertMonthlyAllocation(tx, {
        teacherId: input.teacherId,
        year: input.year,
        month: input.month,
        amountPaisa: input.amountPaisa,
        actorUserId: input.actorUserId,
        reason: input.reason,
      });
      await writeAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'budget.period.allocated',
        entityType: 'budget_monthly_allocation',
        entityId: result.allocationId,
        metadata: {
          teacherId: input.teacherId,
          year: input.year,
          month: input.month,
          amountPaisa: input.amountPaisa,
        },
      });
      return {
        allocation: {
          id: result.allocationId,
          teacherId: input.teacherId,
          year: input.year,
          month: input.month,
          amountPaisa: input.amountPaisa,
        },
        ledgerEntry: result.entry,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        'DUPLICATE_ALLOCATION',
        'The teacher already has an allocation for this year/month.',
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
    if (!(await budget.findTeacher(tx, input.teacherId))) {
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
  const total = await budget.countLedgerEntriesByPeriod(db, teacherId, periodId);
  const entries = await budget.listLedgerEntriesByPeriod(
    db,
    teacherId,
    periodId,
    perPage,
    (page - 1) * perPage,
  );
  return { entries, total };
}
