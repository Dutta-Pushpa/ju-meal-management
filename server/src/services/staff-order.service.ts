import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { notFound, unprocessable } from '../utils/errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as staffOrders from '../models/staff-order.model.js';
import * as orders from '../models/order.model.js';
import * as budget from '../models/budget.model.js';

export async function getStaffOrders(
  db: Database,
  filters: staffOrders.StaffOrderFilters,
  page: number,
  pageSize: number,
) {
  const total = await staffOrders.countStaffOrders(db, filters);
  const rows = await staffOrders.listStaffOrders(db, filters, pageSize, (page - 1) * pageSize);
  const items = await staffOrders.findStaffOrderItems(
    db,
    rows.map((row) => row.id),
  );
  const byOrder = new Map<number, typeof items>();
  for (const item of items)
    byOrder.set(item.order_id, [...(byOrder.get(item.order_id) ?? []), item]);
  return { orders: rows.map((row) => ({ row, items: byOrder.get(row.id) ?? [] })), total };
}

export async function getGroupedStaffOrders(db: Database, date: string) {
  const rows = await staffOrders.listAllStaffOrdersForDate(db, date);
  const items = await staffOrders.findStaffOrderItems(
    db,
    rows.map((row) => row.id),
  );
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) {
    itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  }

  const groups = new Map<
    number,
    {
      location: { id: number; name: string };
      teachers: Set<number>;
      totalPaisa: number;
      itemCounts: Map<string, number>;
      orders: Array<{
        id: number;
        teacherName: string;
        items: Array<{ name: string; quantity: number }>;
        totalPaisa: number;
      }>;
    }
  >();

  for (const row of rows) {
    let group = groups.get(row.food_location_id);
    if (!group) {
      group = {
        location: { id: row.food_location_id, name: row.location_name },
        teachers: new Set(),
        totalPaisa: 0,
        itemCounts: new Map(),
        orders: [],
      };
      groups.set(row.food_location_id, group);
    }
    group.teachers.add(row.teacher_id);
    group.totalPaisa += row.total_paisa;
    const orderItems = (itemsByOrder.get(row.id) ?? []).map((item) => ({
      name: item.item_name_snapshot,
      quantity: item.quantity,
    }));
    for (const item of orderItems) {
      group.itemCounts.set(item.name, (group.itemCounts.get(item.name) ?? 0) + item.quantity);
    }
    group.orders.push({
      id: row.id,
      teacherName: row.teacher_name,
      items: orderItems,
      totalPaisa: row.total_paisa,
    });
  }

  return {
    date,
    orderCount: rows.length,
    locations: [...groups.values()].map((group) => ({
      location: group.location,
      teacherCount: group.teachers.size,
      totalPaisa: group.totalPaisa,
      itemSummary: [...group.itemCounts].map(([name, quantity]) => ({ name, quantity })),
      orders: group.orders,
    })),
    dailyTotalPaisa: rows.reduce((sum, row) => sum + row.total_paisa, 0),
  };
}

export async function changeOrderStatus(
  db: Database,
  input: {
    orderId: number;
    status: 'COLLECTED' | 'DELIVERED';
    actorId: number;
    note: string | null;
  },
) {
  return withTransaction(db, async (tx) => {
    const order = await staffOrders.lockOrderStatus(tx, input.orderId);
    if (!order) throw notFound('Order not found.');
    const allowed =
      (order.status === 'CONFIRMED' && input.status === 'COLLECTED') ||
      (order.status === 'COLLECTED' && input.status === 'DELIVERED');
    if (!allowed) {
      throw unprocessable(
        'INVALID_STATUS_TRANSITION',
        'The requested order status transition is not allowed.',
      );
    }

    // Debit the teacher's budget exactly once when the order is delivered.
    // This is the source-of-truth financial event; placement-time debits are
    // removed and delivery-time debit prevents duplicate charges.
    if (input.status === 'DELIVERED') {
      const existingDebit = await orders.findOrderBudgetPeriod(tx, order.id);
      if (existingDebit === undefined) {
        const periodId = await orders.findPeriodForDate(tx, order.order_date);
        if (periodId === undefined) {
          throw unprocessable(
            'NOT_FOUND',
            'No active budget period covers this order date.',
          );
        }
        const orderYear = parseInt(order.order_date.slice(0, 4), 10);
        const orderMonth = parseInt(order.order_date.slice(5, 7), 10);
        await budget.insertDebit(tx, {
          teacherId: order.teacher_id,
          periodId,
          orderId: order.id,
          amountPaisa: order.total_paisa,
          year: orderYear,
          month: orderMonth,
          reason: 'Meal delivery debit',
          actorUserId: input.actorId,
        });
      }
    }

    await staffOrders.setOrderStatus(tx, order.id, input.status);
    await staffOrders.insertStatusEvent(tx, {
      orderId: order.id,
      oldStatus: order.status,
      newStatus: input.status,
      actorId: input.actorId,
      note: input.note,
    });
    await writeAudit(tx, {
      actorUserId: input.actorId,
      action: 'order.status.changed',
      entityType: 'order',
      entityId: order.id,
      metadata: { oldStatus: order.status, newStatus: input.status, note: input.note },
    });
    return { oldStatus: order.status, status: input.status };
  });
}

export async function changeOrderItemStatus(
  db: Database,
  input: {
    itemId: number;
    status: 'COLLECTED' | 'DELIVERED';
    actorId: number;
    note: string | null;
  },
) {
  return withTransaction(db, async (tx) => {
    const item = await staffOrders.lockOrderItemStatus(tx, input.itemId);
    if (!item) throw notFound('Order item not found.');
    const allowed =
      (item.status === 'PENDING' && input.status === 'COLLECTED') ||
      (item.status === 'COLLECTED' && input.status === 'DELIVERED');
    if (item.order_status === 'CANCELLED' || !allowed) {
      throw unprocessable(
        'INVALID_STATUS_TRANSITION',
        'The requested order item status transition is not allowed.',
      );
    }
    await staffOrders.setOrderItemStatus(tx, item.id, input.status);
    await staffOrders.insertStatusEvent(tx, {
      orderId: item.order_id,
      itemId: item.id,
      oldStatus: item.status,
      newStatus: input.status,
      actorId: input.actorId,
      note: input.note,
    });
    await writeAudit(tx, {
      actorUserId: input.actorId,
      action: 'order.item_status.changed',
      entityType: 'order_item',
      entityId: item.id,
      metadata: {
        orderId: item.order_id,
        oldStatus: item.status,
        newStatus: input.status,
        note: input.note,
      },
    });
    return { oldStatus: item.status, status: input.status };
  });
}
