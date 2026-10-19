import type { Queryable } from '../db/pool.js';

export interface TeacherBudgetSummaryRow {
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

export interface TeacherLedgerRow {
  id: number;
  teacher_id: number;
  budget_period_id: number;
  entry_type: 'allocation' | 'debit' | 'refund' | 'adjustment';
  amount_paisa: number;
  order_id: number | null;
  reason: string | null;
  created_by: number;
  created_at: Date;
}

export async function findBudgetSummary(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<TeacherBudgetSummaryRow | undefined> {
  const { rows } = await db.query<TeacherBudgetSummaryRow>(
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

export async function countLedgerEntries(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM budget_ledger
      WHERE teacher_id = $1 AND budget_period_id = $2`,
    [teacherId, periodId],
  );
  return rows[0]!.total;
}

export async function listLedgerEntries(
  db: Queryable,
  teacherId: number,
  periodId: number,
  limit: number,
  offset: number,
): Promise<TeacherLedgerRow[]> {
  const { rows } = await db.query<TeacherLedgerRow>(
    `SELECT id, teacher_id, budget_period_id, entry_type, amount_paisa, order_id,
            reason, created_by, created_at
       FROM budget_ledger
      WHERE teacher_id = $1 AND budget_period_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [teacherId, periodId, limit, offset],
  );
  return rows;
}
