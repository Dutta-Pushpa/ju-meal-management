import type { FieldIssue } from '@ju/shared';

/**
 * Readers for environment variables.
 *
 * These exist for configuration only, and they differ from request validation
 * in one important way: a misconfigured deployment should learn about every
 * problem in a single pass, not one per restart. The readers therefore throw a
 * {@link ConfigError}, which {@link IssueCollector} turns into a list.
 */

export class ConfigError extends Error {
  readonly issue: FieldIssue;

  constructor(issue: FieldIssue) {
    super(issue.message ?? issue.issue);
    this.name = 'ConfigError';
    this.issue = issue;
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
  throw new ConfigError({ field, issue, message });
}

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
