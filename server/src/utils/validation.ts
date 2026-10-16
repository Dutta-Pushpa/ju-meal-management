/**
 * Minimal input validation.
 *
 * This project does not use a schema library. Validation is hand-written and
 * deliberately small: it covers the cases this API actually has, and nothing
 * more.
 *
 * Two shapes are provided for two different needs:
 *
 *   - {@link IssueCollector} accumulates every problem, which is what
 *     configuration needs, so one run reports all mistakes rather than making
 *     the developer fix them one at a time.
 *   - The `parse` helpers throw {@link ValidationError} on the first problem,
 *     which is what request validation needs, since a request cannot be half
 *     valid.
 *
 * The database still enforces the rules that matter. This layer catches
 * malformed input early and produces useful error messages; it is not a
 * substitute for the constraints described in docs/database.md.
 */

export interface FieldIssue {
  field: string;
  issue: string;
  message?: string;
}

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

/**
 * Collects problems instead of throwing, so a whole configuration can be
 * checked in one pass.
 */
export class IssueCollector {
  private readonly collected: FieldIssue[] = [];

  add(field: string, issue: string, message?: string): void {
    this.collected.push(message === undefined ? { field, issue } : { field, issue, message });
  }

  get issues(): FieldIssue[] {
    return [...this.collected];
  }

  /** `field: message` lines, the form the boot error prints. */
  describe(): string[] {
    return this.collected.map((issue) =>
      issue.message === undefined
        ? `${issue.field}: ${issue.issue}`
        : `${issue.field}: ${issue.message}`,
    );
  }

  get ok(): boolean {
    return this.collected.length === 0;
  }
}

function fail(field: string, issue: string, message: string): never {
  throw new ValidationError([{ field, issue, message }]);
}

// ---------------------------------------------------------------------
// Parsers. Each returns a typed value or records a problem.
// ---------------------------------------------------------------------

/** A required string, optionally length bounded. */
export function readString(
  source: NodeJS.ProcessEnv,
  key: string,
  options: { minLength?: number; default?: string } = {},
): string {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    if (options.default !== undefined) {
      return options.default;
    }
    fail(key, 'required', `${key} is required`);
  }

  if (options.minLength !== undefined && raw.length < options.minLength) {
    fail(key, 'too_small', `${key} must be at least ${options.minLength} characters`);
  }

  return raw;
}

/** An optional string. Absent or empty becomes undefined. */
export function readOptionalString(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  return raw;
}

/**
 * An integer, parsed from a string.
 *
 * Environment variables are always strings, and `Number('abc')` is NaN rather
 * than an error, so the result is checked explicitly instead of being trusted.
 */
export function readInt(
  source: NodeJS.ProcessEnv,
  key: string,
  options: { min?: number; max?: number; default?: number } = {},
): number {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    if (options.default !== undefined) {
      return options.default;
    }
    fail(key, 'required', `${key} is required`);
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    fail(key, 'invalid_type', `${key} must be a whole number, got "${raw}"`);
  }

  if (options.min !== undefined && parsed < options.min) {
    fail(key, 'too_small', `${key} must be at least ${options.min}`);
  }

  if (options.max !== undefined && parsed > options.max) {
    fail(key, 'too_big', `${key} must be at most ${options.max}`);
  }

  return parsed;
}

/**
 * A boolean.
 *
 * `"false"` is truthy as a string, which is the usual source of bugs where a
 * feature meant to be disabled stays enabled. Only the exact strings "true" and
 * "false" are accepted.
 */
export function readBoolean(source: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalised = raw.trim().toLowerCase();

  if (normalised === 'true') {
    return true;
  }

  if (normalised === 'false') {
    return false;
  }

  return fail(key, 'invalid_type', `${key} must be "true" or "false", got "${raw}"`);
}

/** One of a fixed set of values. */
export function readEnum<const T extends readonly string[]>(
  source: NodeJS.ProcessEnv,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  if (!allowed.includes(raw)) {
    fail(key, 'invalid_enum_value', `${key} must be one of: ${allowed.join(', ')}. Got "${raw}"`);
  }

  return raw;
}

/** A string matching a pattern, such as an HH:mm clock time. */
export function readPattern(
  source: NodeJS.ProcessEnv,
  key: string,
  pattern: RegExp,
  message: string,
  fallback?: string,
): string {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    fail(key, 'required', `${key} is required`);
  }

  if (!pattern.test(raw)) {
    fail(key, 'invalid_format', message);
  }

  return raw;
}

/** A non-empty array of values, parsed from a comma-separated string. */
export function readList(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: string[] = [],
): string[] {
  const raw = source[key];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ---------------------------------------------------------------------
// Request body helpers
// ---------------------------------------------------------------------

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

/** Throw unless `value` is an ISO date in YYYY-MM-DD form. */
export function requireIsoDate(value: unknown, field: string): string {
  const text = requireString(value, field);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new ValidationError([
      { field, issue: 'invalid_format', message: `${field} must be a date in YYYY-MM-DD format` },
    ]);
  }

  return text;
}
