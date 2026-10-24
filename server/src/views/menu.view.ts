import type { LocationRow } from '../models/location.model.js';
import type { MenuItemRow } from '../models/menu.model.js';

function presentPrice(amountPaisa: number) {
  return {
    amountPaisa,
    amountFormatted: `৳${(amountPaisa / 100).toFixed(2)}`,
  };
}

export function presentMenuItem(item: MenuItemRow) {
  return {
    id: item.id,
    foodLocationId: item.food_location_id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: presentPrice(item.price_paisa),
    isAvailable: item.is_available,
    isActive: item.is_active,
  };
}

export function presentMenu(location: LocationRow, items: MenuItemRow[]) {
  return {
    data: {
      location: { id: location.id, name: location.name },
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        price: presentPrice(item.price_paisa),
        isAvailable: item.is_available,
      })),
    },
  };
}
