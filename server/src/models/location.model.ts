import type { Queryable } from '../db/pool.js';

/**
 * Food locations (participating vendors).
 *
 * Every query here is parameterised. The only text ever interpolated into SQL
 * is a column name taken from the fixed allow-list inside {@link updateLocation},
 * never a caller-supplied value.
 */

export interface LocationRow {
  id: number;
  name: string;
  name_bn: string | null;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const LOCATION_COLUMNS = `
  id, name, name_bn, description, is_active, created_at, updated_at
`;

export interface CreateLocationInput {
  name: string;
  nameBn: string | null;
  description: string | null;
}

/**
 * A partial update. A field that is absent is left untouched; a nullable field
 * set to `null` is cleared. The two are different, which is why the controller
 * only adds a key when the client actually sent it.
 */
export interface UpdateLocationInput {
  name?: string;
  nameBn?: string | null;
  description?: string | null;
  isActive?: boolean;
}
/** Active locations for the browse view, alphabetically. */
export async function listActiveLocations(db: Queryable): Promise<LocationRow[]> {
  const { rows } = await db.query<LocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM food_locations WHERE is_active ORDER BY name`,
  );

  return rows;
}

/**
 * Look up a location by id, regardless of its active state.
 *
 * Used by the write paths so an administrator can still edit or reactivate a
 * location that the public read paths hide.
 */
export async function findLocationById(
  db: Queryable,
  id: number,
): Promise<LocationRow | undefined> {
  const { rows } = await db.query<LocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM food_locations WHERE id = $1 LIMIT 1`,
    [id],
  );

  return rows[0];
}

/** Look up a location only if it is active, for the public read paths. */
export async function findActiveLocationById(
  db: Queryable,
  id: number,
): Promise<LocationRow | undefined> {
  const { rows } = await db.query<LocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM food_locations WHERE id = $1 AND is_active LIMIT 1`,
    [id],
  );

  return rows[0];
}

export async function insertLocation(
  db: Queryable,
  input: CreateLocationInput,
): Promise<LocationRow> {
  const { rows } = await db.query<LocationRow>(
    `INSERT INTO food_locations (name, name_bn, description)
     VALUES ($1, $2, $3)
     RETURNING ${LOCATION_COLUMNS}`,
    [input.name, input.nameBn, input.description],
  );

  return rows[0]!;
}

/**
 * Apply a partial update.
 *
 * The `SET` clause is assembled from column names chosen here, from this fixed
 * list, so no caller-supplied text can reach the SQL string. Only fields present
 * on `input` are written.
 */
export async function updateLocation(
  db: Queryable,
  id: number,
  input: UpdateLocationInput,
): Promise<LocationRow | undefined> {
  const assignments: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) {
    assign('name', input.name);
  }
  if (input.nameBn !== undefined) {
    assign('name_bn', input.nameBn);
  }
  if (input.description !== undefined) {
    assign('description', input.description);
  }
  if (input.isActive !== undefined) {
    assign('is_active', input.isActive);
  }

  // Nothing to change. Return the current row so the caller still gets a body.
  if (assignments.length === 0) {
    return findLocationById(db, id);
  }

  const { rows } = await db.query<LocationRow>(
    `UPDATE food_locations SET ${assignments.join(', ')}
     WHERE id = $1
     RETURNING ${LOCATION_COLUMNS}`,
    values,
  );

  return rows[0];
}

/**
 * Count the location's non-cancelled orders that fall inside the budget period
 * currently in effect.
 *
 * This is the check behind the rule that a location with live orders cannot be
 * deactivated: pulling a vendor out from under orders that were already placed
 * for this period would strand them. "Now" is resolved in the application
 * timezone, never from a client-supplied date, and the overlap is expressed as a
 * range test so it does not depend on the order date equalling today.
 */
export async function countBlockingOrdersInCurrentPeriod(
  db: Queryable,
  locationId: number,
  timezone: string,
): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM orders o
       JOIN budget_periods p
         ON o.order_date BETWEEN p.starts_on AND p.ends_on
      WHERE o.food_location_id = $1
        AND o.status <> 'CANCELLED'
        AND p.is_active
        AND (now() AT TIME ZONE $2)::date BETWEEN p.starts_on AND p.ends_on`,
    [locationId, timezone],
  );

  return rows[0]?.count ?? 0;
}
