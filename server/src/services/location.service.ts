import type { Database } from '../db/pool.js';
import { conflict, notFound } from '../utils/errors.js';
import { isUniqueViolation } from '../utils/pg-errors.js';
import { writeAudit } from '../models/audit.model.js';
import * as locations from '../models/location.model.js';
import type { LocationRow } from '../models/location.model.js';

/**
 * Food-location rules.
 *
 * Locations are never permanently deleted because historical orders may
 * reference them. Deactivation is refused while a location has blocking
 * orders in the current budget period.
 */

export interface LocationDeps {
  db: Database;
  /** Application timezone, used to resolve the current budget period. */
  timezone: string;
}

export interface CreateLocationInput {
  name: string;
  nameBn: string | null;
  description: string | null;
}

export interface UpdateLocationInput {
  name?: string;
  nameBn?: string | null;
  description?: string | null;
  isActive?: boolean;
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
    // Translate only the location-name constraint.
    // Primary-key collisions must not be reported as duplicate names.
    if (isUniqueViolation(error, 'food_locations_name_unique')) {
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
  // Look up the row regardless of active state, so administrators can
  // edit or reactivate locations hidden from normal read operations.
  const existing = await locations.findLocationById(deps.db, id);

  if (!existing) {
    throw notFound('No location with that id.');
  }

  // Prevent deactivation when blocking orders exist in the current period.
  // Setting an already-inactive location to inactive again is a no-op.
  if (patch.isActive === false && existing.is_active) {
    await assertNoBlockingOrders(deps, existing);
  }

  let updated: LocationRow | undefined;

  try {
    updated = await locations.updateLocation(deps.db, id, patch);
  } catch (error) {
    if (isUniqueViolation(error, 'food_locations_name_unique')) {
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
 * Deactivate a location.
 *
 * Idempotent: deactivating an already-inactive location returns it unchanged.
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

/**
 * Refuse deactivation when non-cancelled orders exist in the current period.
 */
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
