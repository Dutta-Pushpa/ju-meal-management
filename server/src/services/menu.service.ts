import type { Database } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as menu from '../models/menu.model.js';
import type { CreateMenuItemInput, UpdateMenuItemInput } from '../models/menu.model.js';
import { findActiveLocationById } from '../models/location.model.js';

export async function getLocationMenu(db: Database, locationId: number) {
  const result = await menu.findAvailableMenu(db, locationId);

  if (!result.location) {
    throw notFound('No active location with that id.');
  }

  return { location: result.location, items: result.items };
}

export async function createMenuItem(
  db: Database,
  input: CreateMenuItemInput,
  actorUserId: number,
) {
  if (!(await findActiveLocationById(db, input.foodLocationId))) {
    throw notFound('No active location with that id.');
  }
  const item = await menu.insertMenuItem(db, input);
  await writeAudit(db, {
    actorUserId,
    action: 'menu_item.created',
    entityType: 'menu_item',
    entityId: item.id,
    metadata: { foodLocationId: item.food_location_id, name: item.name },
  });
  return item;
}

export async function updateMenuItem(
  db: Database,
  id: number,
  patch: UpdateMenuItemInput,
  actorUserId: number,
) {
  const existing = await menu.findMenuItemById(db, id);
  if (!existing) throw notFound('No menu item with that id.');

  if (
    patch.foodLocationId !== undefined &&
    !(await findActiveLocationById(db, patch.foodLocationId))
  ) {
    throw notFound('No active location with that id.');
  }

  const item = await menu.updateMenuItem(db, id, patch);
  if (!item) throw notFound('No menu item with that id.');
  await writeAudit(db, {
    actorUserId,
    action: 'menu_item.updated',
    entityType: 'menu_item',
    entityId: item.id,
    metadata: { fields: Object.keys(patch).sort() },
  });
  return item;
}

export async function deactivateMenuItem(db: Database, id: number, actorUserId: number) {
  const existing = await menu.findMenuItemById(db, id);
  if (!existing) throw notFound('No menu item with that id.');
  if (!existing.is_active) return existing;

  const item = await menu.deactivateMenuItem(db, id);
  if (!item) throw notFound('No menu item with that id.');
  await writeAudit(db, {
    actorUserId,
    action: 'menu_item.deactivated',
    entityType: 'menu_item',
    entityId: item.id,
    metadata: { name: existing.name },
  });
  return item;
}
