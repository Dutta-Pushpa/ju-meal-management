import { types } from 'pg';

/**
 * node-postgres returns int8 (bigint) columns as strings, because a 64-bit
 * integer can exceed the safe integer range of a JavaScript number and silently
 * losing precision on money would be unacceptable.
 *
 * Every money column in this schema holds paisa. Even a wildly implausible
 * ৳10 billion order is 1e12 paisa, far inside Number.MAX_SAFE_INTEGER, so the
 * API contract of an integer amountPaisa is safe to honour. Returning strings
 * would force every caller to convert, and would quietly turn any forgotten
 * conversion into string concatenation.
 *
 * A counter that genuinely outgrew the safe range would lose precision, but
 * nothing in this schema comes close.
 *
 * This lives in its own module rather than inside pool.ts because the type
 * parser is process-wide: anything that talks to PostgreSQL must import this
 * file for the conversion to apply, including the test helpers, which open
 * their own connections.
 */
export function configureInt8Parsing(): void {
  types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
}

configureInt8Parsing();
