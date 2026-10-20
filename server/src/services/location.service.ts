import type { Database } from '../db/pool.js';
import { conflict, notFound } from '../utils/errors.js';
import { isUniqueViolation } from '../utils/pg-errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as locations from '../models/location.model.js';
import type {
  CreateLocationInput,
  LocationRow,
  UpdateLocationInput,
} from '../models/location.model.js';

export type { CreateLocationInput, UpdateLocationInput };

/**
 * Food-location rules.
 *
 * Deactivation is the interesting rule here. A location is never deleted: rows
 * are only deactivated, because historical orders reference them (policy P8).
 * Deactivation is refused, however, while the location still has orders in the
 * period that is currently running, since those orders were placed against a
 * vendor the department can no longer drop without stranding them.
 */

export interface LocationDeps {
  db: Database;
  /** Application timezone, used to resolve the current budget period. */
  timezone: string;
}

export async function listLocations(deps: LocationDeps): Promise<LocationRow[]> {
  return locations.listActiveLocations(deps.db);
}

/** A single active location. An inactive one is reported as not found. */
export async function getLocation(deps: LocationDeps, id: number): Promise<LocationRow> {
  const row = await locations.findActiveLocationById(deps.db, id);

  if (!row) {
    throw notFound('No active location with that id.');
  }

  return row;
}

export async function createLocation(
  deps: LocationDeps,
  input: CreateLocationInput,
  actorUserId: number,
): Promise<LocationRow> {
  let row: LocationRow;

  try {
    row = await locations.insertLocation(deps.db, input);
  } catch (error) {
    // The unique index on lower(name) is the real guard; this only makes the
    // rejection readable. Reusing the generic handler would mislabel it.
    if (isUniqueViolation(error)) {
      throw conflict('LOCATION_ALREADY_EXISTS', 'A location with that name already exists.');
    }
    throw error;
  }

  await writeAudit(deps.db, {
    actorUserId,
    action: 'location.created',
    entityType: 'food_location',
    entityId: row.id,
    metadata: { name: row.name },
  });

  return row;
}

export async function updateLocation(
  deps: LocationDeps,
  id: number,
  patch: UpdateLocationInput,
  actorUserId: number,
): Promise<LocationRow> {
  // The write paths look the row up regardless of active state, so an
  // administrator can edit or reactivate a location the read paths hide.
  const existing = await locations.findLocationById(deps.db, id);

  if (!existing) {
    throw notFound('No location with that id.');
  }

  // Guard both the DELETE path and an explicit PATCH deactivation. Setting an
  // already-inactive location to false again is a no-op and needs no check.
  if (patch.isActive === false && existing.is_active) {
    await assertNoBlockingOrders(deps, existing);
  }

  let updated: LocationRow | undefined;

  try {
    updated = await locations.updateLocation(deps.db, id, patch);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('LOCATION_ALREADY_EXISTS', 'A location with that name already exists.');
    }
    throw error;
  }

  if (!updated) {
    throw notFound('No location with that id.');
  }

  await writeAudit(deps.db, {
    actorUserId,
    action: 'location.updated',
    entityType: 'food_location',
    entityId: updated.id,
    metadata: { fields: Object.keys(patch).sort() },
  });

  return updated;
}

/**
 * Deactivate a location (the DELETE operation).
 *
 * Idempotent: deactivating an already-inactive location returns it unchanged
 * rather than failing, so a retried request behaves the same as the first.
 */
export async function deactivateLocation(
  deps: LocationDeps,
  id: number,
  actorUserId: number,
): Promise<LocationRow> {
  const existing = await locations.findLocationById(deps.db, id);

  if (!existing) {
    throw notFound('No location with that id.');
  }

  if (!existing.is_active) {
    return existing;
  }

  await assertNoBlockingOrders(deps, existing);

  const updated = await locations.updateLocation(deps.db, id, { isActive: false });

  if (!updated) {
    throw notFound('No location with that id.');
  }

  await writeAudit(deps.db, {
    actorUserId,
    action: 'location.deactivated',
    entityType: 'food_location',
    entityId: updated.id,
    metadata: { name: existing.name },
  });

  return updated;
}

/** Refuse when the location has non-cancelled orders in the current period. */
async function assertNoBlockingOrders(deps: LocationDeps, location: LocationRow): Promise<void> {
  const count = await locations.countBlockingOrdersInCurrentPeriod(
    deps.db,
    location.id,
    deps.timezone,
  );

  if (count > 0) {
    throw conflict(
      'LOCATION_HAS_ACTIVE_ORDERS',
      'This location has orders in the current period and cannot be deactivated.',
    );
  }
}
