import { withTransaction, type Database } from '../db/pool.js';
import type { OrderItemInput, OrderQueryFilters } from '../models/order.model.js';
import * as orders from '../models/order.model.js';
import { internal, notFound, unprocessable } from '../utils/errors.js';
import { writeAudit } from '../models/audit.model.js';

export interface PlaceOrderInput {
  teacherId: number;
  orderDate: string;
  foodLocationId: number;
  idempotencyKey: string;
  items: OrderItemInput[];
}

export async function placeOrder(db: Database, input: PlaceOrderInput) {
  return withTransaction(db, async (tx) => {
    if (!(await orders.lockTeacher(tx, input.teacherId))) {
      throw notFound('Active teacher account not found.');
    }

    const existingId = await orders.findByIdempotencyKey(tx, input.teacherId, input.idempotencyKey);
    if (existingId !== undefined) {
      const existing = await loadOrder(tx, existingId);
      return { ...existing, replayed: true };
    }

    const rule = await orders.checkOrderingRules(tx, input.orderDate);
    if (rule.disabled) {
      throw unprocessable('ORDERING_DISABLED', 'Ordering is disabled for this date.');
    }
    if (rule.closed) {
      throw unprocessable('ORDERING_CLOSED', 'The ordering cutoff for this date has passed.');
    }

    const periodId = await orders.findPeriodForDate(tx, input.orderDate);
    if (periodId === undefined) throw notFound('No active budget period covers this order date.');

    const itemIds = [...new Set(input.items.map((item) => item.menuItemId))];
    const pricedItems = await orders.findPricedItems(tx, itemIds);
    if (pricedItems.length !== itemIds.length) {
      throw unprocessable('ITEM_UNAVAILABLE', 'A requested menu item is unavailable.');
    }
    const locations = new Set(pricedItems.map((item) => item.food_location_id));
    if (locations.size !== 1 || !locations.has(input.foodLocationId)) {
      throw unprocessable('MIXED_LOCATIONS', 'An order must contain items from exactly one location.');
    }

    const byId = new Map(pricedItems.map((item) => [item.id, item]));
    const totalPaisa = input.items.reduce((sum, line) => {
      const item = byId.get(line.menuItemId)!;
      const lineTotal = item.price_paisa * line.quantity;
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(sum + lineTotal)) {
        throw unprocessable('BUDGET_INSUFFICIENT', 'The order total exceeds the supported amount.');
      }
      return sum + lineTotal;
    }, 0);

    const available = await orders.getAvailableBalance(tx, input.teacherId, periodId);
    if (totalPaisa > available) {
      throw unprocessable('BUDGET_INSUFFICIENT', 'Order total exceeds the available balance.');
    }

    const orderId = await orders.createOrder(tx, {
      teacherId: input.teacherId,
      orderDate: input.orderDate,
      locationId: input.foodLocationId,
      totalPaisa,
      idempotencyKey: input.idempotencyKey,
    });
    for (const line of input.items) {
      await orders.createOrderItem(tx, orderId, byId.get(line.menuItemId)!, line);
    }
    await orders.createDebit(tx, { teacherId: input.teacherId, periodId, orderId, totalPaisa });
    await orders.insertConfirmedEvent(tx, orderId, input.teacherId);
    return { ...(await loadOrder(tx, orderId)), replayed: false };
  }, 'SERIALIZABLE');
}

async function loadOrder(db: Parameters<typeof orders.findOrder>[0], id: number) {
  const order = await orders.findOrder(db, id);
  if (!order) throw notFound('Order not found.');
  return { order, items: await orders.findOrderItems(db, id) };
}

export async function getMyOrders(
  db: Database,
  teacherId: number,
  filters: OrderQueryFilters,
  page: number,
  pageSize: number,
) {
  const total = await orders.countTeacherOrders(db, teacherId, filters);
  const rows = await orders.listTeacherOrders(
    db,
    teacherId,
    filters,
    pageSize,
    (page - 1) * pageSize,
  );
  const items = await orders.findItemsForOrders(db, rows.map((row) => row.id));
  const grouped = new Map<number, typeof items>();
  for (const item of items) grouped.set(item.order_id, [...(grouped.get(item.order_id) ?? []), item]);
  return {
    orders: rows.map((row) => ({ row, items: grouped.get(row.id) ?? [] })),
    total,
  };
}

export async function getMyOrder(db: Database, orderId: number, teacherId: number) {
  const order = await orders.findTeacherOrder(db, orderId, teacherId);
  if (!order) throw notFound('Order not found.');
  return { order, items: await orders.findOrderItems(db, orderId) };
}

export async function cancelOrder(
  db: Database,
  input: {
    orderId: number;
    actorId: number;
    actorRole: 'TEACHER' | 'STAFF' | 'ADMIN';
    reason: string | undefined;
  },
) {
  return withTransaction(db, async (tx) => {
    const order = await orders.lockOrderForCancellation(tx, input.orderId);
    if (!order || (input.actorRole === 'TEACHER' && order.teacher_id !== input.actorId)) {
      throw notFound('Order not found.');
    }
    if (order.status !== 'CONFIRMED') {
      throw unprocessable('INVALID_STATUS_TRANSITION', 'Only confirmed orders can be cancelled.');
    }

    const staffOverride = input.actorRole !== 'TEACHER';
    if (!staffOverride) {
      const cutoff = await orders.checkOrderingRules(tx, order.order_date);
      if (cutoff.closed) {
        throw unprocessable('CUTOFF_PASSED', 'The cancellation cutoff for this date has passed.');
      }
    }

    const periodId = await orders.findOrderBudgetPeriod(tx, input.orderId);
    if (periodId === undefined) throw internal('Order debit record is missing.');
    const reason = input.reason ?? 'Cancelled by teacher before cutoff';
    await orders.cancelOrder(tx, input.orderId);
    await orders.insertRefund(tx, {
      teacherId: order.teacher_id,
      periodId,
      orderId: order.id,
      amountPaisa: order.total_paisa,
      reason,
      actorId: input.actorId,
    });
    await orders.insertCancelledEvent(tx, order.id, input.actorId, reason);
    if (staffOverride) {
      await writeAudit(tx, {
        actorUserId: input.actorId,
        action: 'order.cancelled_by_staff',
        entityType: 'order',
        entityId: order.id,
        metadata: { teacherId: order.teacher_id, reason },
      });
    }
    return loadOrder(tx, order.id);
  });
}
