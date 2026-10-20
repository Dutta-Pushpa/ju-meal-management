import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';
import {
  requireBoolean,
  requireObject,
  requireOptionalString,
  requireString,
} from '../utils/validation.js';
import { hasField, readPathId } from '../utils/request.js';
import { currentUser } from '../middleware/auth.js';
import {
  createLocation as createLocationService,
  deactivateLocation as deactivateLocationService,
  getLocation as getLocationService,
  listLocations as listLocationsService,
  updateLocation as updateLocationService,
  type CreateLocationInput,
  type UpdateLocationInput,
} from '../services/location.service.js';
import { presentLocation, presentLocationList } from '../views/location.view.js';

/**
 * Location controller.
 *
 * HTTP concerns only: read and validate the request, call one service, choose a
 * status code, and hand the result to a view.
 */

export interface LocationControllerDeps {
  db: Database;
  timezone: string;
}

const NAME_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 2_000;

/** GET /api/locations */
export function listLocations(deps: LocationControllerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listLocationsService(deps);
    res.status(200).json(presentLocationList(rows));
  };
}

/** GET /api/locations/:id */
export function getLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const row = await getLocationService(deps, readPathId(req));
    res.status(200).json({ data: presentLocation(row) });
  };
}

/** POST /api/locations */
export function createLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');

    const input: CreateLocationInput = {
      name: requireString(body['name'], 'name', { minLength: 1, maxLength: NAME_MAX_LENGTH }),
      nameBn:
        requireOptionalString(body['nameBn'], 'nameBn', { maxLength: NAME_MAX_LENGTH }) ?? null,
      description:
        requireOptionalString(body['description'], 'description', { maxLength: TEXT_MAX_LENGTH }) ??
        null,
    };

    const row = await createLocationService(deps, input, actor.id);
    res.status(201).json({ data: presentLocation(row) });
  };
}

/** PATCH /api/locations/:id */
export function updateLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = requireObject(req.body ?? {}, 'body');
    const id = readPathId(req);

    // Only fields the client actually sent are applied, so an absent field is
    // left untouched rather than blanked out.
    const patch: UpdateLocationInput = {};

    if (hasField(body, 'name')) {
      patch.name = requireString(body['name'], 'name', {
        minLength: 1,
        maxLength: NAME_MAX_LENGTH,
      });
    }
    if (hasField(body, 'nameBn')) {
      patch.nameBn =
        requireOptionalString(body['nameBn'], 'nameBn', {
          maxLength: NAME_MAX_LENGTH,
        }) ?? null;
    }
    if (hasField(body, 'description')) {
      patch.description =
        requireOptionalString(body['description'], 'description', { maxLength: TEXT_MAX_LENGTH }) ??
        null;
    }
    if (hasField(body, 'isActive')) {
      patch.isActive = requireBoolean(body['isActive'], 'isActive');
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest('Supply at least one field to update.');
    }

    const row = await updateLocationService(deps, id, patch, actor.id);
    res.status(200).json({ data: presentLocation(row) });
  };
}

/** DELETE /api/locations/:id — soft deactivation. */
export function deleteLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const row = await deactivateLocationService(deps, readPathId(req), actor.id);
    res.status(200).json({ data: presentLocation(row) });
  };
}
