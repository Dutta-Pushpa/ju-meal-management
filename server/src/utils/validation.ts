import type { FieldIssue } from '@ju/shared';

/**
 * Minimal request validation.
 *
 * This project does not use a schema library. Validation is hand-written and
 * deliberately small: it covers the cases this API actually has, and nothing
 * more.
 *
 * The helpers here throw {@link ValidationError} on the first problem, which is
 * what request validation needs, since a request cannot be half valid.
 *
 * The database still enforces the rules that matter. This layer catches
 * malformed input early and produces useful error messages; it is not a
 * substitute for the constraints described in docs/database.md.
 */

export class ValidationError extends Error {
  readonly issues: FieldIssue[];

  constructor(issues: FieldIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0]!.field}: ${issues[0]!.message ?? issues[0]!.issue}`
        : `Request failed validation with ${issues.length} problems.`,
    );
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** Throw unless `value` is a string, optionally length bounded. */
export function requireString(
  value: unknown,
  field: string,
  options: { minLength?: number; maxLength?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a string` },
    ]);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ValidationError([{ field, issue: 'required', message: `${field} is required` }]);
  }

  if (options.minLength !== undefined && trimmed.length < options.minLength) {
    throw new ValidationError([
      {
        field,
        issue: 'too_small',
        message: `${field} must be at least ${options.minLength} characters`,
      },
    ]);
  }

  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw new ValidationError([
      {
        field,
        issue: 'too_big',
        message: `${field} must be at most ${options.maxLength} characters`,
      },
    ]);
  }

  return trimmed;
}

/**
 * Throw unless `value` is a string that is present, empty, or null.
 *
 * Used for optional text fields, where an absent value and an empty value mean
 * the same thing: leave the column alone.
 */
export function requireOptionalString(
  value: unknown,
  field: string,
  options: { maxLength?: number } = {},
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a string` },
    ]);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw new ValidationError([
      {
        field,
        issue: 'too_big',
        message: `${field} must be at most ${options.maxLength} characters`,
      },
    ]);
  }

  return trimmed;
}

/** Throw unless `value` is an integer within range. */
export function requireInt(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be a whole number` },
    ]);
  }

  if (options.min !== undefined && value < options.min) {
    throw new ValidationError([
      { field, issue: 'too_small', message: `${field} must be at least ${options.min}` },
    ]);
  }

  if (options.max !== undefined && value > options.max) {
    throw new ValidationError([
      { field, issue: 'too_big', message: `${field} must be at most ${options.max}` },
    ]);
  }

  return value;
}

/** Throw unless `value` is one of the allowed strings. */
export function requireEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError([
      {
        field,
        issue: 'invalid_enum_value',
        message: `${field} must be one of: ${allowed.join(', ')}`,
      },
    ]);
  }

  return value;
}

/** Throw unless `value` is a boolean. */
export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be true or false` },
    ]);
  }

  return value;
}

/** Throw unless `value` is a plain object. */
export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError([
      { field, issue: 'invalid_type', message: `${field} must be an object` },
    ]);
  }

  return value as Record<string, unknown>;
}

/**
 * Throw unless `value` is a date in YYYY-MM-DD form.
 *
 * The round trip matters: the JavaScript date parser accepts `2090-02-30` and
 * silently turns it into 2 March, so a format check alone is not enough. The
 * date is parsed and then compared back to the text it came from.
 */
export function requireIsoDate(value: unknown, field: string): string {
  const text = requireString(value, field);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ValidationError([
      { field, issue: 'invalid_format', message: `${field} must be a date in YYYY-MM-DD format` },
    ]);
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ValidationError([
      { field, issue: 'invalid_format', message: `${field} must be a date in YYYY-MM-DD format` },
    ]);
  }

  return text;
}
