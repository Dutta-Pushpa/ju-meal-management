import type { Queryable } from '../db/pool.js';

export interface OrderItemInput {
  menuItemId: number;
  quantity: number;
  notes: string | null;
}

export interface PricedMenuItem {
  id: number;
  food_location_id: number;
  name: string;
  price_paisa: number;
}

export interface CreatedOrder {
  id: number;
  order_date: string;
  food_location_id: number;
  location_name: string;
  status: 'PENDING' | 'ACCEPTED' | 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED';
  total_paisa: number;
  confirmed_at: Date;
}

export interface OrderReadRow extends CreatedOrder {
  teacher_id: number;
}

export interface OrderQueryFilters {
  orderDate?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED' | undefined;
}

export interface OrderItemRow {
  id: number;
  menu_item_id: number | null;
  item_name_snapshot: string;
  unit_price_paisa_snapshot: number;
  quantity: number;
  line_total_paisa: number;
}

export async function findByIdempotencyKey(
  db: Queryable,
  teacherId: number,
  key: string,
): Promise<number | undefined> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM orders WHERE teacher_id = $1 AND idempotency_key = $2`,
    [teacherId, key],
  );
  return rows[0]?.id;
}

export async function lockTeacher(db: Queryable, teacherId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND role = 'TEACHER' AND is_active FOR UPDATE`,
    [teacherId],
  );
  return rows.length > 0;
}

export async function checkOrderingRules(
  db: Queryable,
  orderDate: string,
): Promise<{ closed: boolean }> {
  const { rows } = await db.query<{ closed: boolean }>(
    `SELECT (now() AT TIME ZONE 'Asia/Dhaka') >=
            (($1::date +
              COALESCE(
                (SELECT value #>> '{}' FROM app_settings WHERE key = 'order_placement_deadline'), '12:30'
              )::time) AT TIME ZONE 'Asia/Dhaka') AS closed`,
    [orderDate],
  );
  return { closed: rows[0]!.closed };
}

/**
 * Check whether an order can still be cancelled against the configured
 * cancellation deadline and the order's own state.
 */
export async function checkCancellationRules(
  db: Queryable,
  orderDate: string,
): Promise<{ closed: boolean }> {
  const { rows } = await db.query<{ closed: boolean }>(
    `SELECT (now() AT TIME ZONE 'Asia/Dhaka') >=
            (($1::date + COALESCE(
              (SELECT value #>> '{}' FROM app_settings WHERE key = 'order_cancellation_deadline'), '13:00'
            )::time) AT TIME ZONE 'Asia/Dhaka') AS closed`,
    [orderDate],
  );
  return rows[0]!;
}

export async function findPeriodForDate(
  db: Queryable,
  orderDate: string,
): Promise<number | undefined> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM budget_periods
      WHERE is_active AND $1::date BETWEEN starts_on AND ends_on
      LIMIT 1 FOR SHARE`,
    [orderDate],
  );
  return rows[0]?.id;
}

export async function findPricedItems(db: Queryable, ids: number[]): Promise<PricedMenuItem[]> {
  const { rows } = await db.query<PricedMenuItem>(
    `SELECT m.id, m.food_location_id, m.name, m.price_paisa
       FROM menu_items m
       JOIN food_locations l ON l.id = m.food_location_id AND l.is_active
      WHERE m.id = ANY($1::bigint[]) AND m.is_active AND m.is_available
      ORDER BY m.id
      FOR SHARE OF m, l`,
    [ids],
  );
  return rows;
}

export interface DebtPolicy {
  negativeBalanceAllowed: boolean;
  maxDebtPaisa: number;
  maxAdditionalOrders: number;
}

export async function getDebtPolicy(db: Queryable): Promise<DebtPolicy> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM app_settings
      WHERE key IN ('negative_balance_allowed', 'max_debt_paisa', 'max_additional_orders')`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    negativeBalanceAllowed:
      map.get('negative_balance_allowed') === true || map.get('negative_balance_allowed') === 'true',
    maxDebtPaisa: Number(map.get('max_debt_paisa') ?? 0),
    maxAdditionalOrders: Number(map.get('max_additional_orders') ?? 0),
  };
}

/**
 * Counts the teacher's debt-incurring orders: debit entries whose application
 * left the all-time running balance (allocations + adjustments + debits +
 * refunds) below zero. Teachers who stay within their balance are never
 * counted, so the max_additional_orders cap only limits going into debt.
 */
export async function countDebtOrders(db: Queryable, teacherId: number): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `WITH flow AS (
        SELECT amount_paisa,
               SUM(amount_paisa) OVER (ORDER BY created_at, id) AS running
          FROM budget_ledger
         WHERE teacher_id = $1
      )
      SELECT count(*)::int AS count FROM flow
       WHERE amount_paisa < 0 AND running < 0`,
    [teacherId],
  );
  return rows[0]?.count ?? 0;
}

/** Per-teacher extra debt headroom (paisa) granted on top of the global policy. */
export async function getTeacherDebtAllowance(
  db: Queryable,
  teacherId: number,
): Promise<number> {
  const { rows } = await db.query<{ debt_allowance_paisa: number }>(
    `SELECT debt_allowance_paisa FROM users WHERE id = $1`,
    [teacherId],
  );
  return Number(rows[0]?.debt_allowance_paisa ?? 0);
}

export async function getAvailableBalance(
  db: Queryable,
  teacherId: number,
  year: number,
  month: number,
): Promise<number> {
  // Canonical monthly balance: base allocation for the month, plus carry-forward
  // from every previous month (base allocations + non-allocation ledger
  // activity), plus this month's non-allocation ledger activity. Unused budget
  // rolls forward and overdrafts roll forward too. 'allocation' ledger entries
  // are excluded everywhere because the budget_monthly_allocations row is the
  // source of truth for the base amount.
  const { rows } = await db.query<{ amount_paisa: number }>(
    `WITH cur AS (
       SELECT COALESCE(SUM(l.amount_paisa), 0) AS total
         FROM budget_ledger l
        WHERE l.teacher_id = $1 AND l.year = $2 AND l.month = $3
          AND l.entry_type <> 'allocation'
     ),
     prior_ledger AS (
       SELECT COALESCE(SUM(l.amount_paisa), 0) AS total
         FROM budget_ledger l
        WHERE l.teacher_id = $1
          AND l.year IS NOT NULL AND l.month IS NOT NULL
          AND (l.year < $2 OR (l.year = $2 AND l.month < $3))
          AND l.entry_type <> 'allocation'
     ),
     prior_alloc AS (
       SELECT COALESCE(SUM(a.allocated_paisa), 0) AS total
         FROM budget_monthly_allocations a
        WHERE a.teacher_id = $1
          AND (a.year < $2 OR (a.year = $2 AND a.month < $3))
     )
     SELECT (COALESCE(ma.allocated_paisa, 0)
            + (SELECT total FROM cur)
            + (SELECT total FROM prior_ledger)
            + (SELECT total FROM prior_alloc))::bigint AS amount_paisa
       FROM (SELECT 1) one
       LEFT JOIN budget_monthly_allocations ma
              ON ma.teacher_id = $1 AND ma.year = $2 AND ma.month = $3`,
    [teacherId, year, month],
  );
  return Number(rows[0]?.amount_paisa ?? 0);
}

export async function createOrder(
  db: Queryable,
  input: {
    teacherId: number;
    orderDate: string;
    locationId: number;
    totalPaisa: number;
    idempotencyKey: string;
    alternativeItemName?: string | null;
    alternativeUnitPricePaisa?: number | null;
    status?: string;
  },
): Promise<number> {
  const status = input.status ?? 'CONFIRMED';
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO orders (teacher_id, food_location_id, order_date, total_paisa, idempotency_key,
             alternative_item_name, alternative_unit_price_paisa, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.teacherId,
      input.locationId,
      input.orderDate,
      input.totalPaisa,
      input.idempotencyKey,
      input.alternativeItemName ?? null,
      input.alternativeUnitPricePaisa ?? null,
      status,
    ],
  );
  return rows[0]!.id;
}

export async function processOrder(db: Queryable, orderId: number): Promise<void> {
  await db.query(
    `UPDATE orders SET status = 'ACCEPTED' WHERE id = $1 AND status = 'PENDING'`,
    [orderId],
  );
}

export async function confirmDelivery(
  db: Queryable,
  orderId: number,
  actualCostPaisa: number,
  actorId: number,
  note: string | null,
): Promise<void> {
  await db.query(
    `UPDATE orders
      SET status = 'DELIVERED',
          actual_cost_paisa = $2,
          delivery_confirmed_at = now(),
          delivery_confirmed_by = $4
      WHERE id = $1 AND status = 'ACCEPTED'`,
    [orderId, actualCostPaisa, actorId],
  );
  await insertStatusEvent(db, orderId, 'ACCEPTED', 'DELIVERED', actorId, note);
}

export async function insertStatusEvent(
  db: Queryable,
  orderId: number,
  oldStatus: string,
  newStatus: string,
  actorId: number,
  note: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_events (order_id, old_status, new_status, changed_by, note)
      VALUES ($1, $2, $3, $4, $5)`,
    [orderId, oldStatus, newStatus, actorId, note],
  );
}

export async function createOrderItem(
  db: Queryable,
  orderId: number,
  item: PricedMenuItem,
  input: OrderItemInput,
): Promise<void> {
  await db.query(
    `INSERT INTO order_items
        (order_id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot, quantity, line_total_paisa, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orderId,
      item.id,
      item.name,
      item.price_paisa,
      input.quantity,
      item.price_paisa * input.quantity,
      input.notes,
    ],
  );
}

export async function createDebit(
  db: Queryable,
  input: {
    teacherId: number;
    periodId?: number | undefined;
    orderId: number;
    totalPaisa: number;
    year?: number | undefined;
    month?: number | undefined;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, entry_type, amount_paisa, order_id, reason, created_by, year, month)
     VALUES ($1, $2, 'debit', $3, $4, 'Meal order', $1, $5, $6)`,
    [
      input.teacherId,
      input.periodId ?? null,
      -input.totalPaisa,
      input.orderId,
      input.year ?? null,
      input.month ?? null,
    ],
  );
}

export async function insertConfirmedEvent(
  db: Queryable,
  orderId: number,
  actorId: number,
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_events (order_id, old_status, new_status, changed_by)
     VALUES ($1, NULL, 'CONFIRMED', $2)`,
    [orderId, actorId],
  );
}

export async function findOrder(db: Queryable, orderId: number): Promise<CreatedOrder | undefined> {
  const { rows } = await db.query<CreatedOrder>(
    `SELECT o.id, to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.food_location_id, l.name AS location_name, o.status,
            COALESCE(o.actual_cost_paisa, o.total_paisa) AS total_paisa, o.confirmed_at
       FROM orders o JOIN food_locations l ON l.id = o.food_location_id WHERE o.id = $1`,
    [orderId],
  );
  return rows[0];
}

export async function findOrderItems(db: Queryable, orderId: number): Promise<OrderItemRow[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot,
            quantity, line_total_paisa
       FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows;
}

export async function findTeacherOrder(
  db: Queryable,
  orderId: number,
  teacherId: number,
): Promise<OrderReadRow | undefined> {
  const { rows } = await db.query<OrderReadRow>(
    `SELECT o.id, o.teacher_id, to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.food_location_id, l.name AS location_name, o.status,
            COALESCE(o.actual_cost_paisa, o.total_paisa) AS total_paisa, o.confirmed_at
       FROM orders o JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.id = $1 AND o.teacher_id = $2`,
    [orderId, teacherId],
  );
  return rows[0];
}

export async function countTeacherOrders(
  db: Queryable,
  teacherId: number,
  filters: OrderQueryFilters,
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM orders
      WHERE teacher_id = $1
        AND ($2::date IS NULL OR order_date = $2::date)
        AND ($3::date IS NULL OR order_date >= $3::date)
        AND ($4::date IS NULL OR order_date <= $4::date)
        AND ($5::text IS NULL OR status = $5)`,
    [
      teacherId,
      filters.orderDate ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.status ?? null,
    ],
  );
  return rows[0]!.total;
}

export async function listTeacherOrders(
  db: Queryable,
  teacherId: number,
  filters: OrderQueryFilters,
  limit: number,
  offset: number,
): Promise<OrderReadRow[]> {
  const { rows } = await db.query<OrderReadRow>(
    `SELECT o.id, o.teacher_id, to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.food_location_id, l.name AS location_name, o.status,
            COALESCE(o.actual_cost_paisa, o.total_paisa) AS total_paisa, o.confirmed_at
       FROM orders o JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.teacher_id = $1
        AND ($2::date IS NULL OR o.order_date = $2::date)
        AND ($3::date IS NULL OR o.order_date >= $3::date)
        AND ($4::date IS NULL OR o.order_date <= $4::date)
        AND ($5::text IS NULL OR o.status = $5)
      ORDER BY o.order_date DESC, o.created_at DESC, o.id DESC
      LIMIT $6 OFFSET $7`,
    [
      teacherId,
      filters.orderDate ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.status ?? null,
      limit,
      offset,
    ],
  );
  return rows;
}

export async function findItemsForOrders(db: Queryable, orderIds: number[]) {
  if (orderIds.length === 0) return [];
  const { rows } = await db.query<OrderItemRow & { order_id: number }>(
    `SELECT order_id, id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot,
            quantity, line_total_paisa
       FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY order_id, id`,
    [orderIds],
  );
  return rows;
}

export async function lockOrderForCancellation(
  db: Queryable,
  orderId: number,
): Promise<OrderReadRow | undefined> {
  const { rows } = await db.query<OrderReadRow>(
    `SELECT o.id, o.teacher_id, to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.food_location_id, l.name AS location_name, o.status, o.total_paisa, o.confirmed_at
       FROM orders o JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.id = $1 FOR UPDATE OF o`,
    [orderId],
  );
  return rows[0];
}

/** True when the order already has a placement debit in the ledger. */
export async function hasOrderDebit(db: Queryable, orderId: number): Promise<boolean> {
  const { rows } = await db.query<{ has_debit: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM budget_ledger WHERE order_id = $1 AND entry_type = 'debit'
     ) AS has_debit`,
    [orderId],
  );
  return rows[0]!.has_debit;
}

export interface OrderDebitRecord {
  id: number;
  budget_period_id: number | null;
  year: number | null;
  month: number | null;
}

/** The debit ledger row created for an order, if one exists. Refunds reuse the
 * debit's year/month so the money returns to the same budget month. */
export async function findOrderDebitRecord(
  db: Queryable,
  orderId: number,
): Promise<OrderDebitRecord | undefined> {
  const { rows } = await db.query<OrderDebitRecord>(
    `SELECT id, budget_period_id, year, month FROM budget_ledger
       WHERE order_id = $1 AND entry_type = 'debit'
       ORDER BY id DESC LIMIT 1`,
    [orderId],
  );
  return rows[0];
}

export async function cancelOrder(db: Queryable, orderId: number): Promise<void> {
  await db.query(
    `UPDATE orders SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = $1 AND status IN ('PENDING', 'ACCEPTED', 'CONFIRMED')`,
    [orderId],
  );
}

export async function insertRefund(
  db: Queryable,
  input: {
    teacherId: number;
    periodId?: number | undefined;
    year?: number | undefined;
    month?: number | undefined;
    orderId: number;
    amountPaisa: number;
    reason: string;
    actorId: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, year, month, entry_type, amount_paisa, order_id, reason, created_by)
     VALUES ($1, $2, $3, $4, 'refund', $5, $6, $7, $8)`,
    [
      input.teacherId,
      input.periodId ?? null,
      input.year ?? null,
      input.month ?? null,
      input.amountPaisa,
      input.orderId,
      input.reason,
      input.actorId,
    ],
  );
}

export async function insertCancelledEvent(
  db: Queryable,
  orderId: number,
  actorId: number,
  reason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_events (order_id, old_status, new_status, changed_by, note)
     VALUES ($1, 'CONFIRMED', 'CANCELLED', $2, $3)`,
    [orderId, actorId, reason],
  );
}
