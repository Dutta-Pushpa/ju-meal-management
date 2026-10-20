/**
 * Recognising PostgreSQL errors by their SQLSTATE code.
 *
 * The database is the final authority on constraints, so the services let it
 * reject a bad write and then translate the rejection into a meaningful API
 * error. Matching on `code` rather than on the message is deliberate: the
 * message is localised and version-dependent, while the code is stable.
 */

/** PostgreSQL SQLSTATE codes the application reacts to. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_EXCLUSION_VIOLATION = '23P01';

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  return (error as { code?: string }).code;
}

/** True when a write was rejected because a unique constraint was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === PG_UNIQUE_VIOLATION;
}

/** True when a PostgreSQL exclusion constraint rejected a write. */
export function isExclusionViolation(error: unknown): boolean {
  return sqlState(error) === PG_EXCLUSION_VIOLATION;
}
