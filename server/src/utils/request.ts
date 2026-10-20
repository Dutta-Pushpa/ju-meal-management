import type { Request } from 'express';
import { requireEnum, requireInt, requireIsoDate, ValidationError } from './validation.js';

/**
 * Reading values out of an HTTP request.
 *
 * Every controller needs the same handful of things: an id from the path, a
 * page number from the query, a business date from the query, a field from the
 * body. Each of those was written by hand in several controllers, with the
 * rules drifting apart. These helpers are the single definition.
 *
 * They throw {@link ValidationError}, which the error handler turns into a 400
 * with the offending field name.
 */

/** Whether the request body carried a field at all. */
export function hasField(body: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(body, key);
}

/** A positive integer path parameter, such as `:id`. */
export function readPathId(req: Request, field = 'id'): number {
  const raw = req.params[field];

  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a positive integer` },
    ]);
  }

  return requireInt(Number(raw), field, { min: 1 });
}

/** An integer query parameter, with a fallback when it is absent. */
export function readIntQuery(
  req: Request,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = readOptionalIntQuery(req, key, min, max);
  return value === undefined ? fallback : value;
}

/** An optional integer query parameter. */
export function readOptionalIntQuery(
  req: Request,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = req.query[key];

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new ValidationError([
      { field: key, issue: 'invalid_type', message: `${key} must be a positive integer` },
    ]);
  }

  return requireInt(Number(raw), key, { min, max });
}

/** A required integer query parameter. */
export function requireIntQuery(req: Request, key: string, min: number, max: number): number {
  const value = readOptionalIntQuery(req, key, min, max);

  if (value === undefined) {
    throw new ValidationError([{ field: key, issue: 'required', message: `${key} is required` }]);
  }

  return value;
}

/** An optional business date query parameter, in `YYYY-MM-DD` form. */
export function readDateQuery(req: Request, key: string): string | undefined {
  const raw = req.query[key];

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== 'string') {
    throw new ValidationError([
      { field: key, issue: 'invalid_type', message: `${key} must be a date in YYYY-MM-DD format` },
    ]);
  }

  return requireIsoDate(raw, key);
}

/** A required business date query parameter, in `YYYY-MM-DD` form. */
export function requireDateQuery(req: Request, key: string): string {
  const raw = req.query[key];

  if (raw === undefined) {
    throw new ValidationError([{ field: key, issue: 'required', message: `${key} is required` }]);
  }

  if (typeof raw !== 'string') {
    throw new ValidationError([
      { field: key, issue: 'invalid_type', message: `${key} must be a date in YYYY-MM-DD format` },
    ]);
  }

  return requireIsoDate(raw, key);
}

/** An optional query parameter restricted to a fixed set of values. */
export function readEnumQuery<const T extends readonly string[]>(
  req: Request,
  key: string,
  allowed: T,
): T[number] | undefined {
  const raw = req.query[key];

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== 'string') {
    throw new ValidationError([
      {
        field: key,
        issue: 'invalid_enum_value',
        message: `${key} must be one of: ${allowed.join(', ')}`,
      },
    ]);
  }

  return requireEnum(raw, key, allowed);
}
