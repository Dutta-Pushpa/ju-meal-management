import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import {
  requireBoolean,
  requireInt,
  requireObject,
  requireOptionalString,
  requireString,
} from '../utils/validation.js';
import { hasField, readPathId } from '../utils/request.js';
import {
  createMenuItem as createMenuItemService,
  deactivateMenuItem as deactivateMenuItemService,
  getLocationMenu,
  updateMenuItem as updateMenuItemService,
} from '../services/menu.service.js';
import { presentMenu, presentMenuItem } from '../views/menu.view.js';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2_000;
const CATEGORY_MAX_LENGTH = 100;

export function getMenu(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const { location, items } = await getLocationMenu(db, readPathId(req));
    res.status(200).json(presentMenu(location, items));
  };
}

export function createMenuItem(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const row = await createMenuItemService(
      db,
      {
        foodLocationId: requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 }),
        name: requireString(body['name'], 'name', { minLength: 1, maxLength: NAME_MAX_LENGTH }),
        description:
          requireOptionalString(body['description'], 'description', {
            maxLength: DESCRIPTION_MAX_LENGTH,
          }) ?? null,
        category:
          requireOptionalString(body['category'], 'category', { maxLength: CATEGORY_MAX_LENGTH }) ??
          null,
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

    if (hasField(body, 'foodLocationId')) {
      patch.foodLocationId = requireInt(body['foodLocationId'], 'foodLocationId', { min: 1 });
    }
    if (hasField(body, 'name')) {
      patch.name = requireString(body['name'], 'name', {
        minLength: 1,
        maxLength: NAME_MAX_LENGTH,
      });
    }
    if (hasField(body, 'description')) {
      patch.description =
        requireOptionalString(body['description'], 'description', {
          maxLength: DESCRIPTION_MAX_LENGTH,
        }) ?? null;
    }
    if (hasField(body, 'category')) {
      patch.category =
        requireOptionalString(body['category'], 'category', { maxLength: CATEGORY_MAX_LENGTH }) ??
        null;
    }
    if (hasField(body, 'pricePaisa')) {
      patch.pricePaisa = requireInt(body['pricePaisa'], 'pricePaisa', {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      });
    }
    if (hasField(body, 'isAvailable')) {
      patch.isAvailable = requireBoolean(body['isAvailable'], 'isAvailable');
    }
    if (hasField(body, 'isActive')) patch.isActive = requireBoolean(body['isActive'], 'isActive');
    if (Object.keys(patch).length === 0) throw badRequest('Supply at least one field to update.');

    const row = await updateMenuItemService(db, readPathId(req), patch, actor.id);
    res.status(200).json({ data: presentMenuItem(row) });
  };
}

export function deleteMenuItem(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const row = await deactivateMenuItemService(db, readPathId(req), actor.id);
    res.status(200).json({ data: presentMenuItem(row) });
  };
}
