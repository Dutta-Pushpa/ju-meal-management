import {
  IssueCollector,
  ValidationError,
  readBoolean,
  readEnum,
  readInt,
  readList,
  readOptionalString,
  readString,
} from '../utils/validation.js';

/**
 * Configuration is validated once, at startup, from a single source of truth.
 *
 * The server refuses to boot when something is wrong. Failing at startup with a
 * clear list of problems is far better than failing hours later on the first
 * request that happens to need a missing variable, with no context.
 *
 * This module has no side effects. Loading `.env` happens in the entry point, so
 * a test can import and call this without touching process state.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

const EXAMPLE_SECRET =
  'replace-this-with-a-long-random-string-at-least-32-chars';

export interface AppConfig {
  ADMIN_KEY?: string;

  NODE_ENV: NodeEnv;
  PORT: number;

  DATABASE_URL: string;
  DATABASE_ADMIN_URL: string | undefined;
  DB_POOL_MAX: number;
  DB_POOL_IDLE_TIMEOUT_MS: number;
  DB_CONNECTION_TIMEOUT_MS: number;
  DB_SSL: boolean;

  JWT_SECRET: string;
  JWT_EXPIRES_IN_MINUTES: number;

  BCRYPT_COST: number;

  CORS_ORIGIN: string[];
  TRUST_PROXY: boolean;

  RATE_LIMIT_WINDOW_MINUTES: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: number;

  LOG_LEVEL: LogLevel;
  LOG_PRETTY: boolean;
}

export type LoadConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; issues: string[] };

/**
 * Read one value, recording any problem instead of throwing.
 *
 * The `read` helpers throw, which is correct for a single value but wrong here:
 * a developer fixing configuration wants every mistake in one pass, not the
 * first one followed by a second boot. The thrown ValidationError already
 * carries the variable name, so it is used as‑is.
 */
function collect<T>(issues: IssueCollector, read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof ValidationError) {
      for (const issue of error.issues) {
        issues.add(issue.field, issue.issue, issue.message);
      }
      return undefined;
    }
    throw error;
  }
}

/**
 * Parse configuration from a source map. Defaults to `process.env` so the
 * server can load it at startup, but accepts an explicit source so tests can
 * build a known configuration without mutating global state.
 */
export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
): LoadConfigResult {
  const issues = new IssueCollector();

  const NODE_ENV = collect(issues, () =>
    readEnum(source, 'NODE_ENV', NODE_ENVS, 'development'),
  );
  const PORT = collect(issues, () =>
    readInt(source, 'PORT', { min: 1, max: 65_535, default: 4000 }),
  );

  const DATABASE_URL = collect(issues, () =>
    readString(source, 'DATABASE_URL', { minLength: 1 }),
  );
  const DATABASE_ADMIN_URL = collect(issues, () =>
    readOptionalString(source, 'DATABASE_ADMIN_URL'),
  );
  const DB_POOL_MAX = collect(issues, () =>
    readInt(source, 'DB_POOL_MAX', { min: 1, max: 100, default: 10 }),
  );
  const DB_POOL_IDLE_TIMEOUT_MS = collect(issues, () =>
    readInt(source, 'DB_POOL_IDLE_TIMEOUT_MS', { min: 0, default: 30_000 }),
  );
  const DB_CONNECTION_TIMEOUT_MS = collect(issues, () =>
    readInt(source, 'DB_CONNECTION_TIMEOUT_MS', { min: 0, default: 10_000 }),
  );
  const DB_SSL = collect(issues, () => readBoolean(source, 'DB_SSL', false));

  const JWT_SECRET = collect(issues, () =>
    readString(source, 'JWT_SECRET', { minLength: 32 }),
  );
  const JWT_EXPIRES_IN_MINUTES = collect(issues, () =>
    readInt(source, 'JWT_EXPIRES_IN_MINUTES', {
      min: 1,
      max: 1440,
      default: 720,
    }),
  );

  const BCRYPT_COST = collect(issues, () =>
    readInt(source, 'BCRYPT_COST', { min: 10, max: 15, default: 12 }),
  );

  const CORS_ORIGIN = collect(issues, () =>
    readList(source, 'CORS_ORIGIN', ['http://localhost:5173']),
  );
  const TRUST_PROXY = collect(issues, () =>
    readBoolean(source, 'TRUST_PROXY', false),
  );

  const RATE_LIMIT_WINDOW_MINUTES = collect(issues, () =>
    readInt(source, 'RATE_LIMIT_WINDOW_MINUTES', { min: 1, default: 15 }),
  );
  const RATE_LIMIT_MAX_REQUESTS = collect(issues, () =>
    readInt(source, 'RATE_LIMIT_MAX_REQUESTS', { min: 1, default: 300 }),
  );
  const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = collect(issues, () =>
    readInt(source, 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS', { min: 1, default: 10 }),
  );

  const LOG_LEVEL = collect(issues, () =>
    readEnum(source, 'LOG_LEVEL', LOG_LEVELS, 'info'),
  );
  const LOG_PRETTY = collect(issues, () =>
    readBoolean(source, 'LOG_PRETTY', true),
  );
  const ADMIN_KEY = collect(issues, () =>
    readOptionalString(source, 'ADMIN_KEY'),
  );

  if (NODE_ENV === 'production') {
    if (JWT_SECRET === EXAMPLE_SECRET) {
      issues.add(
        'JWT_SECRET',
        'placeholder',
        'JWT_SECRET is still the example value and must be replaced for production',
      );
    }
    if (LOG_PRETTY === true) {
      issues.add(
        'LOG_PRETTY',
        'unsafe_in_production',
        'LOG_PRETTY must be false in production so logs stay machine readable',
      );
    }
    if (DB_SSL === false) {
      issues.add(
        'DB_SSL',
        'unsafe_in_production',
        'DB_SSL must be true in production',
      );
    }
  }

  if (!issues.ok) {
    return { ok: false, issues: issues.describe() };
  }

  // All values are present when there are no issues.
  return {
    ok: true,
    config: {
      NODE_ENV: NODE_ENV!,
      PORT: PORT!,
      DATABASE_URL: DATABASE_URL!,
      DATABASE_ADMIN_URL,
      DB_POOL_MAX: DB_POOL_MAX!,
      DB_POOL_IDLE_TIMEOUT_MS: DB_POOL_IDLE_TIMEOUT_MS!,
      DB_CONNECTION_TIMEOUT_MS: DB_CONNECTION_TIMEOUT_MS!,
      DB_SSL: DB_SSL!,
      JWT_SECRET: JWT_SECRET!,
      JWT_EXPIRES_IN_MINUTES: JWT_EXPIRES_IN_MINUTES!,
      BCRYPT_COST: BCRYPT_COST!,
      CORS_ORIGIN: CORS_ORIGIN!,
      TRUST_PROXY: TRUST_PROXY!,
      RATE_LIMIT_WINDOW_MINUTES: RATE_LIMIT_WINDOW_MINUTES!,
      RATE_LIMIT_MAX_REQUESTS: RATE_LIMIT_MAX_REQUESTS!,
      LOGIN_RATE_LIMIT_MAX_ATTEMPTS: LOGIN_RATE_LIMIT_MAX_ATTEMPTS!,
      LOG_LEVEL: LOG_LEVEL!,
      LOG_PRETTY: LOG_PRETTY!,
      ...(ADMIN_KEY !== undefined ? { ADMIN_KEY } : {}),
    },
  };
}

/** Throwing variant, used by the entry point. */
export function loadConfigOrThrow(source?: NodeJS.ProcessEnv): AppConfig {
  const result = loadConfig(source);

  if (!result.ok) {
    throw new Error(
      `Invalid configuration:\n${result.issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
  }

  return result.config;
}
