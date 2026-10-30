import type { CreatedOrder, OrderItemRow } from '../models/order.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return { amountPaisa, amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}` };
}

export function presentOrder(order: CreatedOrder, items: OrderItemRow[]) {
  const canCancel =
    order.status === 'CONFIRMED' &&
    order.cancel_deadline !== undefined &&
    order.server_now !== undefined &&
    new Date(order.server_now).getTime() < new Date(order.cancel_deadline).getTime();
  const cancelDeadline = order.cancel_deadline?.toISOString();
  const cancelBlockedReason = canCancel
    ? null
    : order.status !== 'CONFIRMED'
      ? 'Only confirmed orders can be cancelled.'
      : cancelDeadline
        ? `Cancellation closed at ${new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }).format(new Date(cancelDeadline))}.`
        : 'Cancellation availability could not be determined.';
  return {
    id: order.id,
    orderDate: order.order_date,
    foodLocation: { id: order.food_location_id, name: order.location_name },
    status: order.status,
    total: money(order.total_paisa),
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.item_name_snapshot,
      quantity: item.quantity,
      notes: item.notes,
      alternativeMenuItemId: item.alternative_menu_item_id,
      alternativeItem:
        item.alternative_menu_item_id === null
          ? null
          : { id: item.alternative_menu_item_id, name: item.alternative_menu_item_name ?? null },
      unitPrice: money(item.unit_price_paisa_snapshot),
      lineTotal: money(item.line_total_paisa),
    })),
    confirmedAt: order.confirmed_at.toISOString(),
    cancelledAt: order.cancelled_at?.toISOString() ?? null,
    cancelledBy: order.cancelled_by_role ?? null,
    cancelReason: order.cancel_reason ?? null,
    refundAmount: money(order.refund_paisa ?? 0),
    canCancel,
    cancelDeadline: cancelDeadline ?? null,
    cancelBlockedReason,
    actualCost:
      order.actual_cost_paisa === null || order.actual_cost_paisa === undefined
        ? null
        : money(order.actual_cost_paisa),
    settledAt: order.settled_at?.toISOString() ?? null,
    statusTimeline: (order.status_timeline ?? []).map((event) => ({
      ...event,
      changedAt: new Date(event.changedAt).toISOString(),
    })),
    ledgerEntries: (order.ledger_entries ?? []).map((entry) => ({
      ...entry,
      amount: money(entry.amountPaisa),
      createdAt: new Date(entry.createdAt).toISOString(),
    })),
  };
}
