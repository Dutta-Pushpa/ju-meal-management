import type { OrderItemRow } from '../models/order.model.js';
import type { StaffOrderRow } from '../models/staff-order.model.js';

function money(amountPaisa: number) {
  return { amountPaisa, amountFormatted: `৳${(amountPaisa / 100).toFixed(2)}` };
}

export function presentStaffOrder(row: StaffOrderRow, items: OrderItemRow[]) {
  return {
    id: row.id,
    teacher: { id: row.teacher_id, fullName: row.teacher_name },
    foodLocation: { id: row.food_location_id, name: row.location_name },
    orderDate: row.order_date,
    status: row.status,
    total: money(row.total_paisa),
    alternativeItemName: row.alternative_item_name,
    alternativeUnitPrice: row.alternative_unit_price_paisa
      ? money(row.alternative_unit_price_paisa)
      : null,
    items: items.map((item) => ({
      name: item.item_name_snapshot,
      quantity: item.quantity,
      notes: item.notes,
      alternativeMenuItemId: item.alternative_menu_item_id,
      alternativeItem:
        item.alternative_menu_item_id === null
          ? null
          : { id: item.alternative_menu_item_id, name: item.alternative_menu_item_name ?? null },
    })),
    confirmedAt: row.confirmed_at.toISOString(),
  };
}

export function presentGroupedOrders(result: {
  date: string;
  orderCount: number;
  locations: Array<{
    location: { id: number; name: string };
    teacherCount: number;
    totalPaisa: number;
    itemSummary: Array<{ name: string; quantity: number }>;
    orders: Array<{
      id: number;
      teacherName: string;
      items: Array<{
        name: string;
        quantity: number;
        notes: string | null;
        alternativeMenuItemId: number | null;
        alternativeItemName: string | null;
      }>;
      totalPaisa: number;
    }>;
  }>;
  dailyTotalPaisa: number;
}) {
  return {
    date: result.date,
    orderCount: result.orderCount,
    locations: result.locations.map((group) => ({
      location: group.location,
      teacherCount: group.teacherCount,
      total: money(group.totalPaisa),
      itemSummary: group.itemSummary,
      orders: group.orders.map((order) => ({
        id: order.id,
        teacherName: order.teacherName,
        items: order.items,
        total: money(order.totalPaisa),
      })),
    })),
    dailyTotal: money(result.dailyTotalPaisa),
  };
}
