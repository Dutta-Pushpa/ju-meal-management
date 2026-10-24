import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';
import {
  requireBoolean,
  requireInt,
  requireObject,
  requireString,
  ValidationError,
} from '../utils/validation.js';
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
import { listAllLocations } from '../models/location.model.js';

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
    const row = await getLocationService(deps, readId(req));
    res.status(200).json({ data: presentLocation(row) });
  };
}

/** POST /api/locations */
export function createLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = readBody(req);

    const input: CreateLocationInput = {
      name: requireString(body['name'], 'name', { minLength: 1, maxLength: NAME_MAX_LENGTH }),
      nameBn: optionalText(body['nameBn'], 'nameBn', NAME_MAX_LENGTH),
      description: optionalText(body['description'], 'description', TEXT_MAX_LENGTH),
    };

    const row = await createLocationService(deps, input, actor.id);
    res.status(201).json({ data: presentLocation(row) });
  };
}

/** PATCH /api/locations/:id */
export function updateLocation(deps: LocationControllerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const body = readBody(req);
    const id = readId(req);

    // Only fields the client actually sent are applied, so an absent field is
    // left untouched rather than blanked out.
    const patch: UpdateLocationInput = {};

    if (has(body, 'name')) {
      patch.name = requireString(body['name'], 'name', {
        minLength: 1,
        maxLength: NAME_MAX_LENGTH,
      });
    }
    if (has(body, 'nameBn')) {
      patch.nameBn = optionalText(body['nameBn'], 'nameBn', NAME_MAX_LENGTH);
    }
    if (has(body, 'description')) {
      patch.description = optionalText(body['description'], 'description', TEXT_MAX_LENGTH);
    }
    if (has(body, 'isActive')) {
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
    const row = await deactivateLocationService(deps, readId(req), actor.id);
    res.status(200).json({ data: presentLocation(row) });
  };
}

function readBody(req: Request): Record<string, unknown> {
  return requireObject(req.body ?? {}, 'body');
}

function has(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

/** The path id must be a positive integer; anything else is a bad request. */
function readId(req: Request): number {
  return requireInt(Number(req.params['id']), 'id', { min: 1 });
}

/**
 * A nullable text field.
 *
 * Missing, `null`, and an empty string all become `null`, which is how a client
 * clears a value. Anything else must be a string within the length limit.
 */
function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a string or null` },
    ]);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new ValidationError([
      { field, issue: 'too_big', message: `${field} must be at most ${maxLength} characters` },
    ]);
  }

  return trimmed;
}

/** GET /api/locations/manage/all — includes inactive rows for managers. */
export function listAllManagedLocations(deps: LocationControllerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listAllLocations(deps.db);
    res.status(200).json({ data: rows.map(presentLocation), meta: { total: rows.length } });
  };
}
