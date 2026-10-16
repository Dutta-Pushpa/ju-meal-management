import { z } from 'zod';

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

const EXAMPLE_SECRET = 'replace-this-with-a-long-random-string-at-least-32-chars';

/**
 * Environment variables are strings, so both `"false"` and `"true"` must parse.
 * A missing value falls back to `fallback`, given in string form, so the
 * transformed output is always a real boolean rather than a truthy string.
 */
const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_ADMIN_URL: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    DB_SSL: booleanString('false'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

    APP_TIMEZONE: z.string().default('Asia/Dhaka'),
    ORDER_CUTOFF_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'ORDER_CUTOFF_TIME must be HH:mm in 24-hour time')
      .default('12:00'),
    BUDGET_ROLLOVER: booleanString('false'),
    DEFAULT_WEEKLY_BUDGET_PAISA: z.coerce.number().int().min(0).default(70_000),

    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    TRUST_PROXY: booleanString('false'),

    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanString('true'),
  })
  .superRefine((cfg, ctx) => {
    if (!isValidTimeZone(cfg.APP_TIMEZONE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_TIMEZONE'],
        message: `APP_TIMEZONE must be a valid IANA time zone, got "${cfg.APP_TIMEZONE}"`,
      });
    }

    if (cfg.NODE_ENV === 'production') {
      if (cfg.JWT_SECRET === EXAMPLE_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET is still the example value and must be replaced for production',
        });
      }
      if (cfg.LOG_PRETTY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_PRETTY'],
          message: 'LOG_PRETTY must be false in production so logs stay machine readable',
        });
      }
      if (!cfg.DB_SSL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DB_SSL'],
          message: 'DB_SSL must be true in production',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export type LoadConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: string[] };

/**
 * Parse configuration from a source map. Defaults to `process.env` so the
 * server can load it at startup, but accepts an explicit source so tests can
 * build a known configuration without mutating global state.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): LoadConfigResult {
  const result = configSchema.safeParse(source);

  if (result.success) {
    return { ok: true, config: result.data };
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { ok: false, issues };
}

/** Throwing variant, used by the entry point. */
export function loadConfigOrThrow(source?: NodeJS.ProcessEnv): AppConfig {
  const result = loadConfig(source);

  if (!result.ok) {
    throw new Error(
      `Invalid configuration:\n${result.issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
  }

  return result.config;
}
