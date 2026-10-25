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

export interface MonthlyAllocationRow {
  id: number;
  teacher_id: number;
  year: number;
  month: number;
  allocated_paisa: number;
  carried_forward_paisa: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export interface BudgetRequestRow {
  id: number;
  teacher_id: number;
  request_type: 'budget_increase' | 'debt_allowance';
  amount_paisa: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: number | null;
  decided_at: Date | null;
  created_at: Date;
}

export interface BudgetSummaryRow {
  period_id: number;
  period_name: string;
  starts_on: string;
  ends_on: string;
  allocated_paisa: number;
  spent_paisa: number;
  refunded_paisa: number;
  adjusted_paisa: number;
  available_paisa: number;
}

export interface MonthlyBudgetSummaryRow {
  period_id: number;
  period_name: string;
  starts_on: string;
  ends_on: string;
  allocated_paisa: number;
  spent_paisa: number;
  refunded_paisa: number;
  adjusted_paisa: number;
  available_paisa: number;
  allocated_paisa_raw: number;
  carried_forward_paisa: number;
}

export async function findTeacher(db: Queryable, teacherId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND role = 'TEACHER' AND is_active FOR UPDATE`,
    [teacherId],
  );
  return rows.length > 0;
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

export async function findBudgetSummary(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<BudgetSummaryRow | undefined> {
  const { rows } = await db.query<BudgetSummaryRow>(
    `SELECT p.id AS period_id, p.name AS period_name, p.starts_on, p.ends_on,
            COALESCE(SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'allocation'), 0)::bigint AS allocated_paisa,
            -COALESCE(SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'debit'), 0)::bigint AS spent_paisa,
            COALESCE(SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'refund'), 0)::bigint AS refunded_paisa,
            COALESCE(SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'adjustment'), 0)::bigint AS adjusted_paisa,
            COALESCE(SUM(l.amount_paisa), 0)::bigint AS available_paisa
       FROM budget_periods p
       LEFT JOIN budget_ledger l
         ON l.budget_period_id = p.id AND l.teacher_id = $1
       WHERE p.id = $2
       GROUP BY p.id`,
    [teacherId, periodId],
  );
  return rows[0];
}

export async function findMonthlyAllocationSummary(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
): Promise<MonthlyBudgetSummaryRow | undefined> {
  const { rows } = await db.query<MonthlyBudgetSummaryRow>(
    `SELECT COALESCE(SUM(CASE WHEN l.entry_type = 'allocation' THEN l.amount_paisa ELSE 0 END), 0)::bigint AS allocated_paisa,
            -COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE 0 END), 0)::bigint AS spent_paisa,
            COALESCE(SUM(CASE WHEN l.entry_type = 'refund' THEN l.amount_paisa ELSE 0 END), 0)::bigint AS refunded_paisa,
            COALESCE(SUM(CASE WHEN l.entry_type = 'adjustment' THEN l.amount_paisa ELSE 0 END), 0)::bigint AS adjusted_paisa,
            COALESCE(SUM(l.amount_paisa), 0)::bigint AS available_paisa,
            COALESCE(ma.allocated_paisa, 0)::bigint AS allocated_paisa_raw,
            COALESCE(ma.carried_forward_paisa, 0)::bigint AS carried_forward_paisa
       FROM budget_monthly_allocations ma
       LEFT JOIN budget_ledger l
         ON l.teacher_id = ma.teacher_id
        AND l.year = ma.year
        AND l.month = ma.month
      WHERE ma.teacher_id = $1 AND ma.year = $2 AND ma.month = $3
      GROUP BY ma.id`,
    [teacherId, year, month],
  );
  return rows[0];
}

export async function insertMonthlyAllocation(
  db: Queryable,
  input: {
    teacherId: number;
    year: number;
    month: number;
    amountPaisa: number;
    actorUserId: number;
    reason: string;
  },
): Promise<{ allocationId: number; entry: BudgetEntryRow }> {
  const allocation = await db.query<{ id: number }>(
    `INSERT INTO budget_monthly_allocations (teacher_id, year, month, allocated_paisa, created_by)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.teacherId, input.year, input.month, input.amountPaisa, input.actorUserId],
  );
  const { rows } = await db.query<BudgetEntryRow>(
    `INSERT INTO budget_ledger
        (teacher_id, year, month, entry_type, amount_paisa, reason, created_by)
      VALUES ($1, $2, $3, 'allocation', $4, $5, $6)
      RETURNING id, teacher_id, year, month, amount_paisa, reason, created_by, created_at`,
    [input.teacherId, input.year, input.month, input.amountPaisa, input.reason, input.actorUserId],
  );
  return { allocationId: allocation.rows[0]!.id, entry: rows[0]! };
}

/** Insert a debit ledger entry for a delivered order. The caller must ensure
 * no duplicate debit exists for the same order (see staff-order.service.ts). */
export async function insertDebit(
  db: Queryable,
  input: {
    teacherId: number;
    periodId: number;
    orderId: number;
    amountPaisa: number;
    year: number;
    month: number;
    reason: string;
    actorUserId: number;
  },
): Promise<BudgetEntryRow> {
  const { rows } = await db.query<BudgetEntryRow>(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by)
     VALUES ($1, $2, $3, $4, 'debit', $5, $6, $7, $8)
     RETURNING id, teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by, created_at`,
    [
      input.teacherId,
      input.periodId,
      input.year,
      input.month,
      input.amountPaisa,
      input.orderId,
      input.reason,
      input.actorUserId,
    ],
  );
  return rows[0]!;
}

export async function countLedgerEntries(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM budget_ledger
      WHERE teacher_id = $1 AND year = $2 AND month = $3`,
    [teacherId, year, month],
  );
  return rows[0]!.total;
}

export async function listLedgerEntries(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
  limit: number,
  offset: number,
): Promise<BudgetEntryRow[]> {
  const { rows } = await db.query<BudgetEntryRow>(
    `SELECT id, teacher_id, year, month, entry_type, amount_paisa, reason, created_by, created_at, order_id
        FROM budget_ledger
       WHERE teacher_id = $1 AND year = $2 AND month = $3
       ORDER BY created_at DESC, id DESC
       LIMIT $4 OFFSET $5`,
    [teacherId, year, month, limit, offset],
  );
  return rows;
}

export async function countLedgerEntriesByPeriod(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<number> {
  // Get the period's start date to determine year/month
  const { rows } = await db.query<{ starts_on: string }>(
    `SELECT starts_on FROM budget_periods WHERE id = $1`,
    [periodId],
  );
  if (!rows[0]) return 0;
  const startsOn = rows[0].starts_on;
  const year = parseInt(startsOn.slice(0, 4), 10);
  const month = parseInt(startsOn.slice(5, 7), 10);
  return await countLedgerEntries(db, teacherId, year, month);
}

export async function listLedgerEntriesByPeriod(
  db: Queryable,
  teacherId: number,
  periodId: number,
  limit: number,
  offset: number,
): Promise<BudgetEntryRow[]> {
  // Get the period's start date to determine year/month
  const { rows } = await db.query<{ starts_on: string }>(
    `SELECT starts_on FROM budget_periods WHERE id = $1`,
    [periodId],
  );
  if (!rows[0]) return [];
  const startsOn = rows[0].starts_on;
  const year = parseInt(startsOn.slice(0, 4), 10);
  const month = parseInt(startsOn.slice(5, 7), 10);
  return await listLedgerEntries(db, teacherId, year, month, limit, offset);
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

/** Budget periods are safe to expose to authenticated users so they can select their own period. */
export async function listBudgetPeriods(db: Queryable): Promise<BudgetPeriodRow[]> {
  const { rows } = await db.query<BudgetPeriodRow>(
    `SELECT id, name, starts_on, ends_on, is_active, created_at
       FROM budget_periods
      ORDER BY starts_on DESC, id DESC`,
  );
  return rows;
}
