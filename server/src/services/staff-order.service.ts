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
    const effectivePaisa = row.actual_cost_paisa ?? row.total_paisa;
    group.totalPaisa += effectivePaisa;
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
      totalPaisa: effectivePaisa,
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
    dailyTotalPaisa: rows.reduce((sum, row) => sum + (row.actual_cost_paisa ?? row.total_paisa), 0),
  };
}

export async function changeOrderStatus(
  db: Database,
  input: {
    orderId: number;
    status: 'COLLECTED' | 'DELIVERED';
    actorId: number;
    note: string | null;
    actualCostPaisa?: number | undefined;
    alternativeItemName?: string | undefined;
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

    // The teacher is debited the estimated total when the order is placed
    // (see placeOrder). At delivery we only need a debit of our own for legacy
    // orders that have none, so the teacher is never charged twice.
    if (input.status === 'DELIVERED') {
      const alreadyDebited = await orders.hasOrderDebit(tx, order.id);
      if (!alreadyDebited) {
        const periodId = await orders.findPeriodForDate(tx, order.order_date);
        const orderYear = parseInt(order.order_date.slice(0, 4), 10);
        const orderMonth = parseInt(order.order_date.slice(5, 7), 10);
        // periodId is optional under the monthly budget model: the debit is
        // booked to the order's Dhaka month (year/month) in the ledger.
        await budget.insertDebit(tx, {
          teacherId: order.teacher_id,
          periodId: periodId ?? undefined,
          orderId: order.id,
          amountPaisa: -order.total_paisa,
          year: orderYear,
          month: orderMonth,
          reason: 'Meal delivery debit',
          actorUserId: input.actorId,
        });
      }

      // Reconcile the estimate with the actual cost of what was delivered
      // (hold at placement, settle at delivery). The estimated total was
      // debited at placement; a costlier delivery debits the difference, a
      // cheaper one refunds it. `total_paisa` keeps the estimate; the actual
      // cost is stored in `actual_cost_paisa`.
      const actualCost = input.actualCostPaisa ?? order.total_paisa;
      if (actualCost !== order.total_paisa) {
        const orderYear = parseInt(order.order_date.slice(0, 4), 10);
        const orderMonth = parseInt(order.order_date.slice(5, 7), 10);
        const difference = actualCost - order.total_paisa;
        if (difference > 0) {
          await budget.insertDebit(tx, {
            teacherId: order.teacher_id,
            orderId: order.id,
            amountPaisa: -difference,
            year: orderYear,
            month: orderMonth,
            reason: 'Actual cost reconciliation (delivery)',
            actorUserId: input.actorId,
          });
        } else {
          await orders.insertRefund(tx, {
            teacherId: order.teacher_id,
            orderId: order.id,
            amountPaisa: -difference,
            year: orderYear,
            month: orderMonth,
            reason: 'Actual cost reconciliation (delivery)',
            actorId: input.actorId,
          });
        }
      }
      await staffOrders.setOrderDelivered(tx, order.id, {
        actualCostPaisa: actualCost,
        alternativeItemName: input.alternativeItemName ?? undefined,
        actorId: input.actorId,
      });
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
      metadata: {
        oldStatus: order.status,
        newStatus: input.status,
        note: input.note,
        ...(input.status === 'DELIVERED'
          ? {
              actualCostPaisa: input.actualCostPaisa ?? null,
              alternativeItemName: input.alternativeItemName ?? null,
            }
          : {}),
      },
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
