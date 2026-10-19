import type { Queryable } from '../db/pool.js';

export interface DailyLocationTotal {
  location_id: number | null;
  location_name: string | null;
  order_count: number;
  total_paisa: number;
  is_total: number;
}
export interface TeacherBudgetReportRow {
  teacher_id: number;
  teacher_name: string;
  allocated_paisa: number;
  spent_paisa: number;
  refunded_paisa: number;
  adjusted_paisa: number;
  available_paisa: number;
}

export async function getDailyTotals(db: Queryable, date: string): Promise<DailyLocationTotal[]> {
  const { rows } = await db.query<DailyLocationTotal>(
    `SELECT l.id AS location_id, l.name AS location_name,
            count(o.id)::int AS order_count,
            COALESCE(sum(o.total_paisa), 0)::bigint AS total_paisa,
            grouping(l.id)::int AS is_total
       FROM orders o
       JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.order_date = $1::date AND o.status <> 'CANCELLED'
      GROUP BY GROUPING SETS ((l.id, l.name), ())
      ORDER BY is_total, l.name NULLS LAST, l.id NULLS LAST`,
    [date],
  );
  return rows;
}

export async function listTeacherBudgetReport(
  db: Queryable,
  periodId: number,
): Promise<TeacherBudgetReportRow[]> {
  const { rows } = await db.query<TeacherBudgetReportRow>(
    `SELECT u.id AS teacher_id, u.full_name AS teacher_name,
            COALESCE(sum(l.amount_paisa) FILTER (WHERE l.entry_type = 'allocation'), 0)::bigint AS allocated_paisa,
            -COALESCE(sum(l.amount_paisa) FILTER (WHERE l.entry_type = 'debit'), 0)::bigint AS spent_paisa,
            COALESCE(sum(l.amount_paisa) FILTER (WHERE l.entry_type = 'refund'), 0)::bigint AS refunded_paisa,
            COALESCE(sum(l.amount_paisa) FILTER (WHERE l.entry_type = 'adjustment'), 0)::bigint AS adjusted_paisa,
            COALESCE(sum(l.amount_paisa), 0)::bigint AS available_paisa
       FROM budget_ledger l
       JOIN users u ON u.id = l.teacher_id
      WHERE l.budget_period_id = $1
      GROUP BY u.id, u.full_name
      ORDER BY u.full_name, u.id`,
    [periodId],
  );
  return rows;
}
