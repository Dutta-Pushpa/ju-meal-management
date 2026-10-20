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
  status: 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED';
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

export async function checkOrderingRules(
  db: Queryable,
  orderDate: string,
): Promise<{ closed: boolean; disabled: boolean }> {
  const { rows } = await db.query<{ closed: boolean; disabled: boolean }>(
    `SELECT now() >= (($1::date + COALESCE(
              (SELECT value #>> '{}' FROM app_settings WHERE key = 'order_cutoff_time'), '12:00'
            )::time) AT TIME ZONE COALESCE(
              (SELECT value #>> '{}' FROM app_settings WHERE key = 'timezone'), 'Asia/Dhaka'
            )) AS closed,
            EXISTS (
              SELECT 1 FROM app_settings
               WHERE key = 'ordering_disabled_dates'
                 AND value @> to_jsonb($1::text)
            ) AS disabled`,
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

export async function getAvailableBalance(
  db: Queryable,
  teacherId: number,
  periodId: number,
): Promise<number> {
  const { rows } = await db.query<{ amount_paisa: number }>(
    `SELECT COALESCE(SUM(amount_paisa), 0)::bigint AS amount_paisa
       FROM budget_ledger WHERE teacher_id = $1 AND budget_period_id = $2`,
    [teacherId, periodId],
  );
  return rows[0]!.amount_paisa;
}

export async function createOrder(
  db: Queryable,
  input: {
    teacherId: number;
    orderDate: string;
    locationId: number;
    totalPaisa: number;
    idempotencyKey: string;
  },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO orders (teacher_id, food_location_id, order_date, total_paisa, idempotency_key)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.teacherId, input.locationId, input.orderDate, input.totalPaisa, input.idempotencyKey],
  );
  return rows[0]!.id;
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
  input: { teacherId: number; periodId: number; orderId: number; totalPaisa: number },
): Promise<void> {
  await db.query(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, entry_type, amount_paisa, order_id, reason, created_by)
     VALUES ($1, $2, 'debit', $3, $4, 'Meal order', $1)`,
    [input.teacherId, input.periodId, -input.totalPaisa, input.orderId],
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
            o.food_location_id, l.name AS location_name, o.status, o.total_paisa, o.confirmed_at
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
            o.food_location_id, l.name AS location_name, o.status, o.total_paisa, o.confirmed_at
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
            o.food_location_id, l.name AS location_name, o.status, o.total_paisa, o.confirmed_at
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

/**
 * The items of several orders at once.
 *
 * One query for a page of orders is much cheaper than one query per order, and
 * the result is grouped by `order_id` for the caller.
 */
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

/**
 * Group order items by the order they belong to.
 *
 * The teacher order list and the staff views all load a page of orders and
 * then need each order's items. One query for the page and one grouping pass
 * is much cheaper than a query per order.
 */
export function groupItemsByOrder<T extends { order_id: number }>(items: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const item of items) {
    const bucket = grouped.get(item.order_id);

    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.order_id, [item]);
    }
  }

  return grouped;
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

export async function findOrderBudgetPeriod(
  db: Queryable,
  orderId: number,
): Promise<number | undefined> {
  const { rows } = await db.query<{ budget_period_id: number }>(
    `SELECT budget_period_id FROM budget_ledger
      WHERE order_id = $1 AND entry_type = 'debit' LIMIT 1`,
    [orderId],
  );
  return rows[0]?.budget_period_id;
}

export async function cancelOrder(db: Queryable, orderId: number): Promise<void> {
  await db.query(
    `UPDATE orders SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = $1 AND status = 'CONFIRMED'`,
    [orderId],
  );
}

export async function insertRefund(
  db: Queryable,
  input: {
    teacherId: number;
    periodId: number;
    orderId: number;
    amountPaisa: number;
    reason: string;
    actorId: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO budget_ledger
       (teacher_id, budget_period_id, entry_type, amount_paisa, order_id, reason, created_by)
     VALUES ($1, $2, 'refund', $3, $4, $5, $6)`,
    [
      input.teacherId,
      input.periodId,
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
