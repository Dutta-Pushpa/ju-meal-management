import type { Queryable } from '../db/pool.js';

export interface BudgetRequestRow {
  id: number;
  teacher_id: number;
  teacher_name: string;
  request_type: 'budget_increase' | 'debt_allowance';
  amount_paisa: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface InsertBudgetRequestInput {
  teacherId: number;
  requestType: 'budget_increase' | 'debt_allowance';
  amountPaisa: number;
  reason: string;
}

export async function insertBudgetRequest(
  db: Queryable,
  input: InsertBudgetRequestInput,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO budget_requests (teacher_id, request_type, amount_paisa, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.teacherId, input.requestType, input.amountPaisa, input.reason],
  );
  return rows[0]!.id;
}

export async function findBudgetRequest(
  db: Queryable,
  id: number,
): Promise<BudgetRequestRow | undefined> {
  const { rows } = await db.query<BudgetRequestRow>(
    `SELECT r.id, r.teacher_id, teacher.full_name AS teacher_name,
            r.request_type, r.amount_paisa, r.reason, r.status,
            r.decided_by, decider.full_name AS decided_by_name,
            r.decided_at, r.created_at
       FROM budget_requests r
       JOIN users teacher ON teacher.id = r.teacher_id
       LEFT JOIN users decider ON decider.id = r.decided_by
      WHERE r.id = $1`,
    [id],
  );
  return rows[0];
}

export async function listBudgetRequests(
  db: Queryable,
  filters: { teacherId?: number | undefined; status?: string | undefined },
  limit: number,
  offset: number,
): Promise<BudgetRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.teacherId !== undefined) {
    params.push(filters.teacherId);
    conditions.push(`r.teacher_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  const { rows } = await db.query<BudgetRequestRow>(
    `SELECT r.id, r.teacher_id, teacher.full_name AS teacher_name,
            r.request_type, r.amount_paisa, r.reason, r.status,
            r.decided_by, decider.full_name AS decided_by_name,
            r.decided_at, r.created_at
       FROM budget_requests r
       JOIN users teacher ON teacher.id = r.teacher_id
       LEFT JOIN users decider ON decider.id = r.decided_by
       ${where}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function countBudgetRequests(
  db: Queryable,
  filters: { teacherId?: number | undefined; status?: string | undefined },
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.teacherId !== undefined) {
    params.push(filters.teacherId);
    conditions.push(`teacher_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM budget_requests ${where}`,
    params,
  );
  return rows[0]?.count ?? 0;
}

/** Marks a pending request decided. Returns false when the request does not
 * exist or was already decided (the status guard makes deciding idempotent-safe). */
export async function decideBudgetRequest(
  db: Queryable,
  id: number,
  input: { status: 'approved' | 'rejected'; decidedBy: number },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE budget_requests
        SET status = $2, decided_by = $3, decided_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id, input.status, input.decidedBy],
  );
  return (rowCount ?? 0) > 0;
}

/** Adds extra debt headroom (paisa) to a teacher's allowance. */
export async function addDebtAllowance(
  db: Queryable,
  teacherId: number,
  amountPaisa: number,
): Promise<number> {
  const { rows } = await db.query<{ debt_allowance_paisa: number }>(
    `UPDATE users SET debt_allowance_paisa = debt_allowance_paisa + $2
      WHERE id = $1
      RETURNING debt_allowance_paisa`,
    [teacherId, amountPaisa],
  );
  return Number(rows[0]?.debt_allowance_paisa ?? 0);
}
