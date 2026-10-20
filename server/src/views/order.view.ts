import type { CreatedOrder, OrderItemRow } from '../models/order.model.js';
import { presentMoney } from '../utils/money.js';

export function presentOrder(order: CreatedOrder, items: OrderItemRow[]) {
  return {
    id: order.id,
    orderDate: order.order_date,
    foodLocation: { id: order.food_location_id, name: order.location_name },
    status: order.status,
    total: presentMoney(order.total_paisa),
    items: items.map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.item_name_snapshot,
      quantity: item.quantity,
      unitPrice: presentMoney(item.unit_price_paisa_snapshot),
      lineTotal: presentMoney(item.line_total_paisa),
    })),
    confirmedAt: order.confirmed_at.toISOString(),
  };
}
