import type { CreatedOrder, OrderItemRow } from '../models/order.model.js';

function money(amountPaisa: number) {
  const sign = amountPaisa < 0 ? '-' : '';
  return { amountPaisa, amountFormatted: `${sign}৳${(Math.abs(amountPaisa) / 100).toFixed(2)}` };
}

export function presentOrder(order: CreatedOrder, items: OrderItemRow[]) {
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
      unitPrice: money(item.unit_price_paisa_snapshot),
      lineTotal: money(item.line_total_paisa),
    })),
    confirmedAt: order.confirmed_at.toISOString(),
  };
}
