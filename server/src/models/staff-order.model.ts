import type { Queryable } from '../db/pool.js';
import type { OrderItemRow } from './order.model.js';

export interface StaffOrderFilters {
  date: string;
  locationId?: number | undefined;
  status?: 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED' | undefined;
  teacherId?: number | undefined;
}

export interface StaffOrderRow {
  id: number;
  teacher_id: number;
  teacher_name: string;
  food_location_id: number;
  location_name: string;
  order_date: string;
  status: 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED';
  /** Estimate charged at placement. */
  total_paisa: number;
  /** Actual cost confirmed at delivery; null until delivered. */
  actual_cost_paisa: number | null;
  alternative_item_name: string | null;
  alternative_unit_price_paisa: number | null;
  confirmed_at: Date;
}

export async function lockOrderStatus(db: Queryable, orderId: number) {
  const { rows } = await db.query<{
    id: number;
    teacher_id: number;
    order_date: string;
    status: StaffOrderRow['status'];
    total_paisa: number;
  }>(
    `SELECT o.id, o.teacher_id, o.total_paisa, to_char(o.order_date, 'YYYY-MM-DD') AS order_date, o.status
       FROM orders o WHERE o.id = $1 FOR UPDATE`,
    [orderId],
  );
  return rows[0];
}

export async function setOrderStatus(
  db: Queryable,
  orderId: number,
  status: Exclude<StaffOrderRow['status'], 'CANCELLED'>,
): Promise<void> {
  await db.query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, status]);
}

/** Records the delivery outcome: the actual cost of what was really delivered
 * (and the alternative item, when one was supplied) plus who confirmed it.
 * `total_paisa` keeps the estimate the teacher was charged at placement; the
 * actual cost lives in `actual_cost_paisa`. Reports and views use
 * COALESCE(actual_cost_paisa, total_paisa) as the effective cost. */
export async function setOrderDelivered(
  db: Queryable,
  orderId: number,
  input: {
    actualCostPaisa: number;
    alternativeItemName?: string | undefined;
    actorId: number;
  },
): Promise<void> {
  await db.query(
    `UPDATE orders
        SET actual_cost_paisa = $2,
            alternative_item_name = COALESCE($3, alternative_item_name),
            delivery_confirmed_at = now(),
            delivery_confirmed_by = $4
      WHERE id = $1`,
    [orderId, input.actualCostPaisa, input.alternativeItemName ?? null, input.actorId],
  );
}

export async function lockOrderItemStatus(db: Queryable, itemId: number) {
  const { rows } = await db.query<{
    id: number;
    order_id: number;
    order_status: StaffOrderRow['status'];
    status: 'PENDING' | 'COLLECTED' | 'DELIVERED';
  }>(
    `SELECT i.id, i.order_id, o.status AS order_status, i.status
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.id = $1 FOR UPDATE OF i, o`,
    [itemId],
  );
  return rows[0];
}

export async function setOrderItemStatus(
  db: Queryable,
  itemId: number,
  status: 'COLLECTED' | 'DELIVERED',
): Promise<void> {
  await db.query(`UPDATE order_items SET status = $2 WHERE id = $1`, [itemId, status]);
}

export async function insertStatusEvent(
  db: Queryable,
  input: {
    orderId: number;
    itemId?: number;
    oldStatus: string;
    newStatus: string;
    actorId: number;
    note: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_events
       (order_id, order_item_id, old_status, new_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.orderId,
      input.itemId ?? null,
      input.oldStatus,
      input.newStatus,
      input.actorId,
      input.note,
    ],
  );
}

export async function countStaffOrders(db: Queryable, filters: StaffOrderFilters): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM orders o
      WHERE o.order_date = $1::date
        AND ($2::bigint IS NULL OR o.food_location_id = $2)
        AND ($3::text IS NOT NULL OR o.status <> 'CANCELLED')
        AND ($3::text IS NULL OR o.status = $3)
        AND ($4::bigint IS NULL OR o.teacher_id = $4)`,
    [filters.date, filters.locationId ?? null, filters.status ?? null, filters.teacherId ?? null],
  );
  return rows[0]!.total;
}

export async function listStaffOrders(
  db: Queryable,
  filters: StaffOrderFilters,
  pageSize: number,
  offset: number,
): Promise<StaffOrderRow[]> {
  const { rows } = await db.query<StaffOrderRow>(
    `SELECT o.id, o.teacher_id, u.full_name AS teacher_name,
            o.food_location_id, l.name AS location_name,
            to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.status, o.total_paisa, o.actual_cost_paisa, o.confirmed_at,
            o.alternative_item_name, o.alternative_unit_price_paisa
       FROM orders o
       JOIN users u ON u.id = o.teacher_id
       JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.order_date = $1::date
        AND ($2::bigint IS NULL OR o.food_location_id = $2)
        AND ($3::text IS NOT NULL OR o.status <> 'CANCELLED')
        AND ($3::text IS NULL OR o.status = $3)
        AND ($4::bigint IS NULL OR o.teacher_id = $4)
      ORDER BY l.name, u.full_name, o.created_at, o.id
      LIMIT $5 OFFSET $6`,
    [
      filters.date,
      filters.locationId ?? null,
      filters.status ?? null,
      filters.teacherId ?? null,
      pageSize,
      offset,
    ],
  );
  return rows;
}

export async function listAllStaffOrdersForDate(
  db: Queryable,
  date: string,
): Promise<StaffOrderRow[]> {
  const { rows } = await db.query<StaffOrderRow>(
    `SELECT o.id, o.teacher_id, u.full_name AS teacher_name,
            o.food_location_id, l.name AS location_name,
            to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
            o.status, o.total_paisa, o.actual_cost_paisa, o.confirmed_at,
            o.alternative_item_name, o.alternative_unit_price_paisa
       FROM orders o
       JOIN users u ON u.id = o.teacher_id
       JOIN food_locations l ON l.id = o.food_location_id
      WHERE o.order_date = $1::date AND o.status <> 'CANCELLED'
      ORDER BY l.name, u.full_name, o.created_at, o.id`,
    [date],
  );
  return rows;
}

export async function findStaffOrderItems(
  db: Queryable,
  orderIds: number[],
): Promise<Array<OrderItemRow & { order_id: number }>> {
  if (orderIds.length === 0) return [];
  const { rows } = await db.query<OrderItemRow & { order_id: number }>(
    `SELECT order_id, id, menu_item_id, item_name_snapshot, unit_price_paisa_snapshot,
            quantity, line_total_paisa
       FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY order_id, id`,
    [orderIds],
  );
  return rows;
}
