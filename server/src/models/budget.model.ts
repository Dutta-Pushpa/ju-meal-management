import type { Queryable } from '../db/pool.js';

export interface BudgetPeriodRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_at: Date;
}

export interface BudgetEntryRow {
  id: number;
  teacher_id: number;
  budget_period_id: number;
  entry_type: 'allocation' | 'debit' | 'refund' | 'adjustment';
  amount_paisa: number;
  order_id?: number | null;
  reason: string | null;
  created_by: number;
  created_at: Date;
}

export async function teacherExists(db: Queryable, teacherId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND role = 'TEACHER'`,
    [teacherId],
  );
  return rows.length > 0;
}

export async function findActivePeriod(db: Queryable, periodId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM budget_periods WHERE id = $1 AND is_active FOR SHARE`,
    [periodId],
  );
  return rows.length > 0;
}

export async function budgetPeriodExists(db: Queryable, periodId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM budget_periods WHERE id = $1`, [
    periodId,
  ]);
  return rows.length > 0;
}

export async function insertPeriod(
  db: Queryable,
  input: { name: string; startsOn: string; endsOn: string },
): Promise<BudgetPeriodRow> {
  const { rows } = await db.query<BudgetPeriodRow>(
    `INSERT INTO budget_periods (name, starts_on, ends_on)
     VALUES ($1, $2, $3)
     RETURNING id, name, starts_on, ends_on, is_active, created_at`,
    [input.name, input.startsOn, input.endsOn],
  );
  return rows[0]!;
}

export async function budgetRolloverEnabled(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    `SELECT COALESCE(
       (SELECT value = 'true'::jsonb FROM app_settings WHERE key = 'budget_rollover'),
       false
     ) AS enabled`,
  );
  return rows[0]!.enabled;
}

export interface RolloverBalance {
  teacher_id: number;
  source_period_name: string;
  amount_paisa: number;
}

export async function listRolloverBalances(
  db: Queryable,
  startsOn: string,
): Promise<RolloverBalance[]> {
  const { rows } = await db.query<RolloverBalance>(
    `SELECT l.teacher_id, source.name AS source_period_name, SUM(l.amount_paisa)::bigint AS amount_paisa
       FROM budget_periods source
       JOIN budget_ledger l ON l.budget_period_id = source.id
       JOIN users u ON u.id = l.teacher_id AND u.role = 'TEACHER' AND u.is_active
      WHERE source.id = (
        SELECT id FROM budget_periods WHERE ends_on < $1 ORDER BY ends_on DESC, id DESC LIMIT 1
      )
      GROUP BY l.teacher_id, source.name
     HAVING SUM(l.amount_paisa) > 0
      ORDER BY l.teacher_id`,
    [startsOn],
  );
  return rows;
}

export async function insertAllocation(
  db: Queryable,
  input: {
    teacherId: number;
    periodId: number;
    amountPaisa: number;
    actorUserId: number;
    reason: string;
  },
): Promise<{ allocationId: number; entry: BudgetEntryRow }> {
  const allocation = await db.query<{ id: number }>(
    `INSERT INTO budget_allocations (teacher_id, budget_period_id, amount_paisa, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.teacherId, input.periodId, input.amountPaisa, input.actorUserId],
  );
  const { rows } = await db.query<BudgetEntryRow>(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by)
     VALUES ($1, $2, 'allocation', $3, $4, $5)
     RETURNING id, teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by, created_at`,
    [input.teacherId, input.periodId, input.amountPaisa, input.reason, input.actorUserId],
  );
  return { allocationId: allocation.rows[0]!.id, entry: rows[0]! };
}

export async function insertAdjustment(
  db: Queryable,
  input: {
    teacherId: number;
    periodId: number;
    amountPaisa: number;
    actorUserId: number;
    reason: string;
  },
): Promise<BudgetEntryRow> {
  const { rows } = await db.query<BudgetEntryRow>(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by)
     VALUES ($1, $2, 'adjustment', $3, $4, $5)
     RETURNING id, teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by, created_at`,
    [input.teacherId, input.periodId, input.amountPaisa, input.reason, input.actorUserId],
  );
  return rows[0]!;
}
