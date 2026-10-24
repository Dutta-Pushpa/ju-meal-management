import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import { requireBoolean, requireInt, requireObject, requireString } from '../utils/validation.js';
import {
  createMenuItem as createMenuItemService,
  deactivateMenuItem as deactivateMenuItemService,
  getLocationMenu,
  updateMenuItem as updateMenuItemService,
} from '../services/menu.service.js';
import { presentMenu, presentMenuItem } from '../views/menu.view.js';
import { listManagedMenuItems as listManagedMenuItemRows } from '../models/menu.model.js';

export function getMenu(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const locationId = requireInt(Number(req.params['id']), 'id', { min: 1 });
    const { location, items } = await getLocationMenu(db, locationId);
    res.status(200).json(presentMenu(location, items));
  };
}

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2_000;
const CATEGORY_MAX_LENGTH = 100;

export function createMenuItem(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const row = await createMenuItemService(
      db,
      {
        foodLocationId: requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 }),
        name: requireString(body['name'], 'name', { minLength: 1, maxLength: NAME_MAX_LENGTH }),
        description: optionalText(body['description'], 'description', DESCRIPTION_MAX_LENGTH),
        category: optionalText(body['category'], 'category', CATEGORY_MAX_LENGTH),
        pricePaisa: requireInt(body['pricePaisa'], 'pricePaisa', {
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
        }),
        isAvailable:
          body['isAvailable'] === undefined
            ? true
            : requireBoolean(body['isAvailable'], 'isAvailable'),
      },
      actor.id,
    );
    res.status(201).json({ data: presentMenuItem(row) });
  };
}

export function updateMenuItem(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const patch: Parameters<typeof updateMenuItemService>[2] = {};

    if (has(body, 'foodLocationId')) {
      patch.foodLocationId = requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 });
    }
    if (has(body, 'name')) {
      patch.name = requireString(body['name'], 'name', {
        minLength: 1,
        maxLength: NAME_MAX_LENGTH,
      });
    }
    if (has(body, 'description')) {
      patch.description = optionalText(body['description'], 'description', DESCRIPTION_MAX_LENGTH);
    }
    if (has(body, 'category')) {
      patch.category = optionalText(body['category'], 'category', CATEGORY_MAX_LENGTH);
    }
    if (has(body, 'pricePaisa')) {
      patch.pricePaisa = requireInt(body['pricePaisa'], 'pricePaisa', {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      });
    }
    if (has(body, 'isAvailable')) {
      patch.isAvailable = requireBoolean(body['isAvailable'], 'isAvailable');
    }
    if (has(body, 'isActive')) patch.isActive = requireBoolean(body['isActive'], 'isActive');
    if (Object.keys(patch).length === 0) throw badRequest('Supply at least one field to update.');

    const row = await updateMenuItemService(db, readId(req), patch, actor.id);
    res.status(200).json({ data: presentMenuItem(row) });
  };
}

export function deleteMenuItem(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const row = await deactivateMenuItemService(db, readId(req), actor.id);
    res.status(200).json({ data: presentMenuItem(row) });
  };
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function readId(req: Request): number {
  return requireInt(Number(req.params['id']), 'id', { min: 1 });
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string or null.`, [
      { field, issue: 'invalid_type', message: `${field} must be a string or null` },
    ]);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw badRequest(`${field} must be at most ${maxLength} characters.`, [
      { field, issue: 'too_big', message: `${field} must be at most ${maxLength} characters` },
    ]);
  }
  return trimmed;
}

/** GET /api/staff/menu-items — full catalogue for authorized managers. */
export function listManagedMenuItems(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listManagedMenuItemRows(db);
    res.status(200).json({
      data: rows.map((item) => ({
        ...presentMenuItem(item),
        location: { id: item.food_location_id, name: item.location_name },
      })),
      meta: { total: rows.length },
    });
  };
}
