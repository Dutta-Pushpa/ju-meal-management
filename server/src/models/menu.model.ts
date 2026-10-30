import type { Queryable } from '../db/pool.js';
import type { LocationRow } from './location.model.js';

export interface MenuItemRow {
  id: number;
  food_location_id: number;
  name: string;
  description: string | null;
  category: string | null;
  price_paisa: number;
  is_available: boolean;
  is_active: boolean;
}

export interface CreateMenuItemInput {
  foodLocationId: number;
  name: string;
  description: string | null;
  category: string | null;
  pricePaisa: number;
  isAvailable: boolean;
}

export interface UpdateMenuItemInput {
  foodLocationId?: number;
  name?: string;
  description?: string | null;
  category?: string | null;
  pricePaisa?: number;
  isAvailable?: boolean;
  isActive?: boolean;
}

const MENU_ITEM_COLUMNS = `
  id, food_location_id, name, description, category, price_paisa,
  is_available, is_active
`;

/** Load an active location and its menu, including sold-out active items. */
export async function findAvailableMenu(
  db: Queryable,
  locationId: number,
): Promise<{ location: LocationRow | undefined; items: MenuItemRow[] }> {
  const locationResult = await db.query<LocationRow>(
    `SELECT id, name, name_bn, description, is_active, created_at, updated_at
       FROM food_locations
      WHERE id = $1 AND is_active
      LIMIT 1`,
    [locationId],
  );

  if (!locationResult.rows[0]) {
    return { location: undefined, items: [] };
  }

  const itemResult = await db.query<MenuItemRow>(
    `SELECT ${MENU_ITEM_COLUMNS}
       FROM menu_items
      WHERE food_location_id = $1 AND is_active
      ORDER BY category NULLS LAST, name, id`,
    [locationId],
  );

  return { location: locationResult.rows[0], items: itemResult.rows };
}

export async function findMenuItemById(
  db: Queryable,
  id: number,
): Promise<MenuItemRow | undefined> {
  const { rows } = await db.query<MenuItemRow>(
    `SELECT ${MENU_ITEM_COLUMNS} FROM menu_items WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function insertMenuItem(
  db: Queryable,
  input: CreateMenuItemInput,
): Promise<MenuItemRow> {
  const { rows } = await db.query<MenuItemRow>(
    `INSERT INTO menu_items
       (food_location_id, name, description, category, price_paisa, is_available)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MENU_ITEM_COLUMNS}`,
    [
      input.foodLocationId,
      input.name,
      input.description,
      input.category,
      input.pricePaisa,
      input.isAvailable,
    ],
  );
  return rows[0]!;
}

export async function updateMenuItem(
  db: Queryable,
  id: number,
  input: UpdateMenuItemInput,
): Promise<MenuItemRow | undefined> {
  const assignments: string[] = [];
  const values: unknown[] = [id];
  const assign = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.foodLocationId !== undefined) assign('food_location_id', input.foodLocationId);
  if (input.name !== undefined) assign('name', input.name);
  if (input.description !== undefined) assign('description', input.description);
  if (input.category !== undefined) assign('category', input.category);
  if (input.pricePaisa !== undefined) assign('price_paisa', input.pricePaisa);
  if (input.isAvailable !== undefined) assign('is_available', input.isAvailable);
  if (input.isActive !== undefined) assign('is_active', input.isActive);

  if (assignments.length === 0) return findMenuItemById(db, id);

  const { rows } = await db.query<MenuItemRow>(
    `UPDATE menu_items SET ${assignments.join(', ')} WHERE id = $1
     RETURNING ${MENU_ITEM_COLUMNS}`,
    values,
  );
  return rows[0];
}

export async function deactivateMenuItem(
  db: Queryable,
  id: number,
): Promise<MenuItemRow | undefined> {
  const { rows } = await db.query<MenuItemRow>(
    `UPDATE menu_items SET is_active = false WHERE id = $1
     RETURNING ${MENU_ITEM_COLUMNS}`,
    [id],
  );
  return rows[0];
}

export interface ManagedMenuItemRow extends MenuItemRow {
  location_name: string;
}

/** All menu rows for staff administration, including unavailable/inactive items. */
export async function listManagedMenuItems(db: Queryable): Promise<ManagedMenuItemRow[]> {
  const { rows } = await db.query<ManagedMenuItemRow>(
    `SELECT m.id, m.food_location_id, l.name AS location_name, m.name, m.description,
            m.category, m.price_paisa, m.is_available, m.is_active
       FROM menu_items m
       JOIN food_locations l ON l.id = m.food_location_id
      ORDER BY l.name, m.category NULLS LAST, m.name, m.id`,
  );
  return rows;
}
