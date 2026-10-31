import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { conflict, notFound } from '../utils/errors.js';
import { isExclusionViolation, isUniqueViolation } from '../utils/pg-errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as budget from '../models/budget.model.js';

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
          rolledOverBalance: await budget.listRolloverBalances(tx, input.startsOn),
        },
      });
      return {
        ...period,
        rolledOverBalance: await budget.listRolloverBalances(tx, input.startsOn),
      };
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
        action: 'budget.monthly.allocated',
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
        'The teacher already has an allocation for this month. Use an increase or decrease to edit it.',
      );
    }
    throw error;
  }
}

/**
 * Increase or decrease a teacher's budget for a specific month. The delta is
 * recorded as an 'adjustment' ledger entry keyed to that month; it therefore
 * takes part in the remaining balance immediately and joins the carry-forward
 * automatically in later months.
 */
export async function adjustBudget(
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
  return withTransaction(db, async (tx) => {
    if (!(await budget.findTeacher(tx, input.teacherId))) {
      throw notFound('No active teacher with that id.');
    }
    const entry = await budget.insertAdjustment(tx, {
      teacherId: input.teacherId,
      year: input.year,
      month: input.month,
      amountPaisa: input.amountPaisa,
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'budget.monthly.adjusted',
      entityType: 'budget_ledger',
      entityId: entry.id,
      metadata: {
        teacherId: input.teacherId,
        year: input.year,
        month: input.month,
        amountPaisa: input.amountPaisa,
      },
    });
    return entry;
  });
}

export async function getBudgetLedger(
  db: Database,
  teacherId: number,
  year: number,
  month: number,
  page: number,
  perPage: number,
) {
  if (!(await budget.teacherExists(db, teacherId))) throw notFound('Teacher not found.');
  const total = await budget.countLedgerEntries(db, teacherId, year, month);
  const entries = await budget.listLedgerEntries(
    db,
    teacherId,
    year,
    month,
    perPage,
    (page - 1) * perPage,
  );
  return { entries, total };
}

/** Monthly budget planning table: every active teacher with their allocation
 * for the month, the carried-forward amount and the remaining balance. */
export function getMonthlySummary(db: Database, year: number, month: number) {
  return budget.findMonthlyTeacherBalances(db, year, month);
}

/** Successful (non-cancelled) orders of one budget month. */
export async function getMonthTransactions(
  db: Database,
  input: {
    year: number;
    month: number;
    teacherId?: number | undefined;
    page: number;
    perPage: number;
  },
) {
  const totals = await budget.totalMonthTransactions(db, input.year, input.month, input.teacherId);
  const rows = await budget.listMonthTransactions(
    db,
    input.year,
    input.month,
    input.teacherId,
    input.perPage,
    (input.page - 1) * input.perPage,
  );
  return { rows, total: totals.count, totalPaisa: totals.totalPaisa };
}

export interface BudgetHistory {
  anchor: { year: number; month: number };
  months: Array<{
    year: number;
    month: number;
    label: string;
    totalAllocatedPaisa: number;
    teachers: Array<{ teacherId: number; teacherName: string; allocatedPaisa: number }>;
  }>;
  grandTotalPaisa: number;
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

/** Effective allocations per teacher for the six months ending at the anchor
 * month (inclusive), with the total allocation per month and overall. */
export async function getBudgetHistory(
  db: Database,
  anchorYear: number,
  anchorMonth: number,
): Promise<BudgetHistory> {
  const months: BudgetHistory['months'] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const year = anchorMonth - offset < 1 ? anchorYear - 1 : anchorYear;
    const month = ((anchorMonth - offset - 1 + 12) % 12) + 1;
    months.push({
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      totalAllocatedPaisa: 0,
      teachers: [],
    });
  }
  const startYearMonth = months[0]!.year * 100 + months[0]!.month;
  const rows = await budget.listMonthlyAllocationsWindow(db, startYearMonth, anchorYear * 100 + anchorMonth);
  const byMonth = new Map(months.map((m) => [m.year * 100 + m.month, m]));
  for (const row of rows) {
    const bucket = byMonth.get(row.year * 100 + row.month);
    if (!bucket) continue;
    bucket.teachers.push({
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      allocatedPaisa: Number(row.allocated_paisa),
    });
    bucket.totalAllocatedPaisa += Number(row.allocated_paisa);
  }
  return {
    anchor: { year: anchorYear, month: anchorMonth },
    months,
    grandTotalPaisa: months.reduce((sum, m) => sum + m.totalAllocatedPaisa, 0),
  };
}
