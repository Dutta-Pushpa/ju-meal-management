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
  alternativeItemName?: string | null;
  alternativeUnitPricePaisa?: number | null;
}

export async function placeOrder(db: Database, input: PlaceOrderInput) {
  return withTransaction(
    db,
    async (tx) => {
      if (!(await orders.lockTeacher(tx, input.teacherId))) {
        throw notFound('Active teacher account not found.');
      }

      const existingId = await orders.findByIdempotencyKey(
        tx,
        input.teacherId,
        input.idempotencyKey,
      );
      if (existingId !== undefined) {
        const existing = await loadOrder(tx, existingId);
        return { ...existing, replayed: true };
      }

      const rule = await orders.checkOrderingRules(tx, input.orderDate);
      if (rule.closed) {
        throw unprocessable('ORDERING_CLOSED', 'The ordering cutoff for this date has passed.');
      }

      // Monthly budgets do not require a legacy budget period; the debit is
      // booked to the order's Dhaka month (year/month) in the ledger.
      const periodId = await orders.findPeriodForDate(tx, input.orderDate);

      const itemIds = [...new Set(input.items.map((item) => item.menuItemId))];
      const pricedItems = await orders.findPricedItems(tx, itemIds);
      if (pricedItems.length !== itemIds.length) {
        throw unprocessable('ITEM_UNAVAILABLE', 'A requested menu item is unavailable.');
      }
      const locations = new Set(pricedItems.map((item) => item.food_location_id));
      if (locations.size !== 1 || !locations.has(input.foodLocationId)) {
        throw unprocessable(
          'MIXED_LOCATIONS',
          'An order must contain items from exactly one location.',
        );
      }

      const byId = new Map(pricedItems.map((item) => [item.id, item]));
      const totalPaisa = input.items.reduce((sum, line) => {
        const item = byId.get(line.menuItemId)!;
        const lineTotal = item.price_paisa * line.quantity;
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(sum + lineTotal)) {
          throw unprocessable(
            'BUDGET_INSUFFICIENT',
            'The order total exceeds the supported amount.',
          );
        }
        return sum + lineTotal;
      }, 0);

      const orderYear = parseInt(input.orderDate.slice(0, 4), 10);
      const orderMonth = parseInt(input.orderDate.slice(5, 7), 10);

      const available = await orders.getAvailableBalance(
        tx,
        input.teacherId,
        orderYear,
        orderMonth,
      );

      const debtPolicy = await orders.getDebtPolicy(tx);
      // A teacher's approved debt-allowance requests add extra headroom on top
      // of the global maximum debt.
      const teacherAllowance = await orders.getTeacherDebtAllowance(tx, input.teacherId);
      const effectiveMaxDebt = debtPolicy.maxDebtPaisa + teacherAllowance;

      if (totalPaisa > available) {
        if (!debtPolicy.negativeBalanceAllowed) {
          throw unprocessable('BUDGET_INSUFFICIENT', 'Order total exceeds the available balance.');
        }
        const resultingDebt = totalPaisa - available;
        if (effectiveMaxDebt > 0 && resultingDebt > effectiveMaxDebt) {
          throw unprocessable(
            'BUDGET_INSUFFICIENT',
            `Order total exceeds the permitted maximum debt limit of ৳${(effectiveMaxDebt / 100).toFixed(2)}.`,
          );
        }
        if (debtPolicy.maxAdditionalOrders > 0) {
          const currentDebtOrders = await orders.countDebtOrders(tx, input.teacherId);
          if (currentDebtOrders >= debtPolicy.maxAdditionalOrders) {
            throw unprocessable(
              'BUDGET_INSUFFICIENT',
              `Permitted additional order limit (${debtPolicy.maxAdditionalOrders}) exceeded.`,
            );
          }
        }
      }

      const orderId = await orders.createOrder(tx, {
        teacherId: input.teacherId,
        orderDate: input.orderDate,
        locationId: input.foodLocationId,
        totalPaisa,
        idempotencyKey: input.idempotencyKey,
        alternativeItemName: input.alternativeItemName ?? null,
        alternativeUnitPricePaisa: input.alternativeUnitPricePaisa ?? null,
      });
      for (const line of input.items) {
        await orders.createOrderItem(tx, orderId, byId.get(line.menuItemId)!, line);
      }
      await orders.createDebit(tx, {
        teacherId: input.teacherId,
        periodId,
        orderId,
        totalPaisa,
        year: orderYear,
        month: orderMonth,
      });
      await orders.insertConfirmedEvent(tx, orderId, input.teacherId);
      return { ...(await loadOrder(tx, orderId)), replayed: false };
    },
    'SERIALIZABLE',
  );
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
  const items = await orders.findItemsForOrders(
    db,
    rows.map((row) => row.id),
  );
  const grouped = new Map<number, typeof items>();
  for (const item of items)
    grouped.set(item.order_id, [...(grouped.get(item.order_id) ?? []), item]);
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
      const cutoff = await orders.checkCancellationRules(tx, order.order_date);
      if (cutoff.closed) {
        throw unprocessable('CUTOFF_PASSED', 'The cancellation cutoff for this date has passed.');
      }
    }

    // The refund returns the money to the month the debit was recorded in, so
    // monthly balances (and any carried-forward overdraft) stay consistent.
    const debit = await orders.findOrderDebitRecord(tx, input.orderId);
    if (debit === undefined) throw internal('Order debit record is missing.');
    const reason = input.reason ?? 'Cancelled by teacher before cutoff';
    await orders.cancelOrder(tx, input.orderId);
    await orders.insertRefund(tx, {
      teacherId: order.teacher_id,
      periodId: debit.budget_period_id ?? undefined,
      year: debit.year ?? undefined,
      month: debit.month ?? undefined,
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
