import { types } from 'pg';

/**
 * Return DATE columns as the plain `YYYY-MM-DD` string PostgreSQL sent.
 *
 * node-postgres parses a `date` into a JavaScript Date at local midnight. Two
 * things go wrong with that: the API contract calls a business date a calendar
 * date rather than an instant, and serialising the Date shifts it by the
 * server's UTC offset. A period starting on 2769-10-23 would come back as
 * 2769-10-22T18:00:00.000Z in Asia/Dhaka.
 *
 * Returning the raw string keeps every model's `starts_on: string` and
 * `order_date: string` type honest. Timestamp columns use timestamptz and are
 * unaffected: they still become Date objects, which the views turn into ISO
 * instants with `toISOString()`.
 *
 * Like the int8 parser, this is process-wide, so anything that talks to
 * PostgreSQL must import this module for the conversion to apply.
 */
types.setTypeParser(types.builtins.DATE, (value: string) => value);
