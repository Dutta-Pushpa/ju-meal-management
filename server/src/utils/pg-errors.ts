/**
 * Recognising PostgreSQL errors by their SQLSTATE code.
 *
 * The database is the final authority on constraints, so the services let it
 * reject a bad write and then translate the rejection into a meaningful API
 * error. Matching on `code` rather than on the message is deliberate: the
 * message is localised and version-dependent, while the code is stable.
 */

/** True when a write was rejected because a unique constraint was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

/** True when a PostgreSQL exclusion constraint rejected a write. */
export function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01'
  );
}
