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
  budget_period_id?: number | null;
  year?: number | null;
  month?: number | null;
  entry_type: 'allocation' | 'debit' | 'refund' | 'adjustment';
  amount_paisa: number;
  order_id?: number | null;
  reason: string | null;
  created_by: number;
  created_at: Date;
  running_balance_paisa?: number;
  order_date?: string | null;
  location_id?: number | null;
  location_name?: string | null;
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

export interface TeacherMonthlyBalanceRow {
  teacher_id: number;
  teacher_name: string;
  email: string;
  has_allocation: boolean;
  /** Base allocation stored in budget_monthly_allocations for the month. */
  allocated_paisa: number;
  /** Net admin adjustments recorded on the ledger for the month (may be ±). */
  adjusted_paisa: number;
  /**
   * Budget carried into this month from all previous months: base allocations
   * of prior months plus non-allocation ledger activity (debits, refunds,
   * adjustments). Unused budget rolls forward and overdrafts roll forward too.
   */
  carry_forward_paisa: number;
  /** Confirmed order debits in this month (positive). */
  spent_paisa: number;
  /** Cancellation refunds in this month (positive). */
  refunded_paisa: number;
  /** allocated + adjusted + carry_forward - spent + refunded. May be negative. */
  available_paisa: number;
}

export interface MonthlyBudgetSummaryRow extends TeacherMonthlyBalanceRow {
  period_id: number;
  period_name: string;
  starts_on: string;
  ends_on: string;
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
  const balance = await findTeacherMonthlyBalance(db, teacherId, year, month);
  if (!balance) return undefined;
  return {
    ...balance,
    // Legacy/compatibility fields retained while callers migrate off periods.
    period_id: year * 100 + month,
    period_name: `${year}-${String(month).padStart(2, '0')}`,
    starts_on: `${year}-${String(month).padStart(2, '0')}-01`,
    ends_on: `${year}-${String(month).padStart(2, '0')}-31`,
    allocated_paisa_raw: balance.allocated_paisa,
    carried_forward_paisa: balance.carry_forward_paisa,
  };
}

const MONTHLY_BALANCE_SELECT = `
  WITH cur AS (
    SELECT l.teacher_id,
           SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'debit') AS debit_paisa,
           SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'refund') AS refund_paisa,
           SUM(l.amount_paisa) FILTER (WHERE l.entry_type = 'adjustment') AS adjustment_paisa
      FROM budget_ledger l
     WHERE l.year = $1 AND l.month = $2 AND l.entry_type <> 'allocation'
     GROUP BY l.teacher_id
  ),
  prior_ledger AS (
    SELECT l.teacher_id, SUM(l.amount_paisa) AS carry_paisa
      FROM budget_ledger l
     WHERE l.year IS NOT NULL AND l.month IS NOT NULL
       AND (l.year < $1 OR (l.year = $1 AND l.month < $2))
       AND l.entry_type <> 'allocation'
     GROUP BY l.teacher_id
  ),
  prior_alloc AS (
    SELECT a.teacher_id, SUM(a.allocated_paisa) AS carry_paisa
      FROM budget_monthly_allocations a
     WHERE a.year < $1 OR (a.year = $1 AND a.month < $2)
     GROUP BY a.teacher_id
  )
  SELECT u.id AS teacher_id,
         u.full_name AS teacher_name,
         u.email,
         (ma.id IS NOT NULL) AS has_allocation,
         COALESCE(ma.allocated_paisa, 0)::bigint AS allocated_paisa,
         COALESCE(c.adjustment_paisa, 0)::bigint AS adjusted_paisa,
         (COALESCE(pl.carry_paisa, 0) + COALESCE(pa.carry_paisa, 0))::bigint AS carry_forward_paisa,
         -COALESCE(c.debit_paisa, 0)::bigint AS spent_paisa,
         COALESCE(c.refund_paisa, 0)::bigint AS refunded_paisa,
         (COALESCE(ma.allocated_paisa, 0)
          + COALESCE(c.adjustment_paisa, 0)
          + COALESCE(c.debit_paisa, 0)
          + COALESCE(c.refund_paisa, 0)
          + COALESCE(pl.carry_paisa, 0)
          + COALESCE(pa.carry_paisa, 0))::bigint AS available_paisa
    FROM users u
    LEFT JOIN budget_monthly_allocations ma
           ON ma.teacher_id = u.id AND ma.year = $1 AND ma.month = $2
    LEFT JOIN cur c ON c.teacher_id = u.id
    LEFT JOIN prior_ledger pl ON pl.teacher_id = u.id
    LEFT JOIN prior_alloc pa ON pa.teacher_id = u.id
`;

export async function findMonthlyTeacherBalances(
  db: Queryable,
  year: number,
  month: number,
): Promise<TeacherMonthlyBalanceRow[]> {
  const { rows } = await db.query<TeacherMonthlyBalanceRow>(
    `${MONTHLY_BALANCE_SELECT}
      WHERE u.role = 'TEACHER' AND u.is_active
      ORDER BY u.full_name, u.id`,
    [year, month],
  );
  return rows;
}

export async function findTeacherMonthlyBalance(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
): Promise<TeacherMonthlyBalanceRow | undefined> {
  const { rows } = await db.query<TeacherMonthlyBalanceRow>(
    `${MONTHLY_BALANCE_SELECT}
      WHERE u.id = $3`,
    [year, month, teacherId],
  );
  return rows[0];
}

export interface SixMonthAllocationRow {
  teacher_id: number;
  teacher_name: string;
  year: number;
  month: number;
  allocated_paisa: number;
}

/** Effective allocation per teacher per month (base allocation plus any
 * adjustments recorded for that month) inside a year/month window. */
export async function listMonthlyAllocationsWindow(
  db: Queryable,
  startYearMonth: number,
  endYearMonth: number,
): Promise<SixMonthAllocationRow[]> {
  const { rows } = await db.query<SixMonthAllocationRow>(
    `SELECT ma.teacher_id, u.full_name AS teacher_name, ma.year, ma.month,
            (ma.allocated_paisa + COALESCE(adj.total_paisa, 0))::bigint AS allocated_paisa
       FROM budget_monthly_allocations ma
       JOIN users u ON u.id = ma.teacher_id AND u.is_active
       LEFT JOIN (
         SELECT l.teacher_id, l.year, l.month, SUM(l.amount_paisa) AS total_paisa
           FROM budget_ledger l
          WHERE l.entry_type = 'adjustment'
          GROUP BY l.teacher_id, l.year, l.month
       ) adj ON adj.teacher_id = ma.teacher_id AND adj.year = ma.year AND adj.month = ma.month
      WHERE (ma.year * 100 + ma.month) BETWEEN $1 AND $2
        AND u.role = 'TEACHER'
      ORDER BY (ma.year * 100 + ma.month), u.full_name, u.id`,
    [startYearMonth, endYearMonth],
  );
  return rows;
}

export interface MonthTransactionRow {
  id: number;
  teacher_id: number;
  teacher_name: string;
  order_date: string;
  total_paisa: number;
  status: string;
}

/** Successful (non-cancelled) orders placed within the budget month. */
export async function countMonthTransactions(
  db: Queryable,
  year: number,
  month: number,
  teacherId: number | undefined,
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM orders o
      WHERE o.status <> 'CANCELLED'
        AND o.order_date >= make_date($2, $3, 1)
        AND o.order_date < make_date($2, $3, 1) + INTERVAL '1 month'
        AND ($1::bigint IS NULL OR o.teacher_id = $1)`,
    [teacherId ?? null, year, month],
  );
  return rows[0]!.total;
}

export async function listMonthTransactions(
  db: Queryable,
  year: number,
  month: number,
  teacherId: number | undefined,
  limit: number,
  offset: number,
): Promise<MonthTransactionRow[]> {
  const { rows } = await db.query<MonthTransactionRow>(
    `SELECT o.id, o.teacher_id, u.full_name AS teacher_name,
            to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.total_paisa, o.status
       FROM orders o
       JOIN users u ON u.id = o.teacher_id
      WHERE o.status <> 'CANCELLED'
        AND o.order_date >= make_date($2, $3, 1)
        AND o.order_date < make_date($2, $3, 1) + INTERVAL '1 month'
        AND ($1::bigint IS NULL OR o.teacher_id = $1)
      ORDER BY o.order_date DESC, o.id DESC
      LIMIT $4 OFFSET $5`,
    [teacherId ?? null, year, month, limit, offset],
  );
  return rows;
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
      RETURNING id, teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by, created_at`,
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
    periodId?: number | undefined;
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
      input.periodId ?? null,
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

export interface LedgerFilters {
  from?: string;
  to?: string;
  status?: 'allocation' | 'debit' | 'refund' | 'adjustment';
}

export async function countLedgerEntries(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
  filters: LedgerFilters = {},
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM budget_ledger
      WHERE teacher_id = $1 AND year = $2 AND month = $3
        AND ($4::date IS NULL OR created_at >= $4::date)
        AND ($5::date IS NULL OR created_at < $5::date + INTERVAL '1 day')
        AND ($6::text IS NULL OR entry_type = $6)`,
    [teacherId, year, month, filters.from ?? null, filters.to ?? null, filters.status ?? null],
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
  filters: LedgerFilters = {},
): Promise<BudgetEntryRow[]> {
  const { rows } = await db.query<BudgetEntryRow>(
    `WITH opening AS (
       SELECT COALESCE((SELECT SUM(a.allocated_paisa) FROM budget_monthly_allocations a
                         WHERE a.teacher_id = $1 AND (a.year < $2 OR (a.year = $2 AND a.month < $3))), 0)
            + COALESCE((SELECT SUM(l.amount_paisa) FROM budget_ledger l
                         WHERE l.teacher_id = $1 AND (l.year < $2 OR (l.year = $2 AND l.month < $3))
                           AND l.year IS NOT NULL AND l.month IS NOT NULL AND l.entry_type <> 'allocation'), 0)
            + COALESCE((SELECT a.allocated_paisa FROM budget_monthly_allocations a
                         WHERE a.teacher_id = $1 AND a.year = $2 AND a.month = $3), 0) AS amount_paisa
     ), month_entries AS (
       SELECT l.id, l.teacher_id, l.year, l.month, l.entry_type, l.amount_paisa, l.order_id,
              l.reason, l.created_by, l.created_at,
              (SELECT amount_paisa FROM opening)
                + SUM(CASE WHEN l.entry_type = 'allocation' THEN 0 ELSE l.amount_paisa END)
                    OVER (ORDER BY l.created_at, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS running_balance_paisa
         FROM budget_ledger l
        WHERE l.teacher_id = $1 AND l.year = $2 AND l.month = $3
     )
     SELECT b.id, b.teacher_id, b.year, b.month, b.entry_type, b.amount_paisa, b.order_id,
            b.reason, b.created_by, b.created_at, b.running_balance_paisa,
            to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.food_location_id AS location_id, fl.name AS location_name
       FROM month_entries b
       LEFT JOIN orders o ON o.id = b.order_id
       LEFT JOIN food_locations fl ON fl.id = o.food_location_id
      WHERE ($6::date IS NULL OR b.created_at >= $6::date)
        AND ($7::date IS NULL OR b.created_at < $7::date + INTERVAL '1 day')
        AND ($8::text IS NULL OR b.entry_type = $8)
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $4 OFFSET $5`,
    [
      teacherId,
      year,
      month,
      limit,
      offset,
      filters.from ?? null,
      filters.to ?? null,
      filters.status ?? null,
    ],
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
  filters: LedgerFilters = {},
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
  return await listLedgerEntries(db, teacherId, year, month, limit, offset, filters);
}

export async function insertAdjustment(
  db: Queryable,
  input: {
    teacherId: number;
    year: number;
    month: number;
    amountPaisa: number;
    actorUserId: number;
    reason: string;
  },
): Promise<BudgetEntryRow> {
  const { rows } = await db.query<BudgetEntryRow>(
    `INSERT INTO budget_ledger
       (teacher_id, year, month, entry_type, amount_paisa, reason, created_by)
     VALUES ($1, $2, $3, 'adjustment', $4, $5, $6)
     RETURNING id, teacher_id, budget_period_id, year, month, entry_type, amount_paisa, reason, created_by, created_at`,
    [input.teacherId, input.year, input.month, input.amountPaisa, input.reason, input.actorUserId],
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
