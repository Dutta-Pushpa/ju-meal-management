/**
 * Resolution of the test database connection string.
 *
 * The integration suite migrates the schema and truncates every table for real,
 * so it must never point at a development or production database. This module
 * derives a `_test` connection string from configuration and nothing else, so
 * it can be unit tested without a database.
 *
 * The rules are:
 *
 *   1. `TEST_DATABASE_URL` wins, if it is set. It must already name a `_test`
 *      database.
 *   2. Otherwise the string is derived from `DATABASE_ADMIN_URL`, or from
 *      `DATABASE_URL` when there is no admin URL: the host loses `-pooler` so
 *      the connection is direct, and the database name becomes `ju_meal_test`
 *      unless it already ends in `_test`.
 */

/** The database name used when one has to be derived. */
const DEFAULT_TEST_DATABASE = 'ju_meal_test';

/** The maintenance database. `CREATE DATABASE` cannot run inside the target. */
export const ADMIN_DATABASE = 'postgres';

export function databaseNameOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

export function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

/**
 * Put a connection string into the shape the tooling needs.
 *
 * The direct endpoint is used, never the pooler: migrations hold a session-level
 * advisory lock and run multi-statement transactions, which a transaction
 * pooler cannot keep across statements. A hosted provider requires TLS, so
 * `sslmode=require` is added when the string does not carry one.
 */
function normaliseTestUrl(url: string): string {
  const parsed = new URL(url);

  parsed.hostname = parsed.hostname.replace('-pooler', '');

  if (!isLocalHost(parsed.hostname) && !parsed.searchParams.has('sslmode')) {
    parsed.searchParams.set('sslmode', 'require');
  }

  return parsed.toString();
}

/**
 * Refuse a database the integration suite would also refuse, with a message
 * that says where the string came from.
 */
function assertTestDatabaseName(url: string, source: string): void {
  const name = databaseNameOf(url);

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to use "${name || '(unparseable URL)'}" as a test database (${source}).\n` +
        'The integration suite migrates the schema and truncates every table for\n' +
        'real, so the database name must end in "_test".',
    );
  }
}

/** The connection string for the test database. */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['TEST_DATABASE_URL']?.trim();

  if (explicit) {
    assertTestDatabaseName(explicit, 'TEST_DATABASE_URL');
    return normaliseTestUrl(explicit);
  }

  const base = env['DATABASE_ADMIN_URL']?.trim() || env['DATABASE_URL']?.trim();

  if (!base) {
    throw new Error(
      'No database connection string is configured.\n' +
        'Set TEST_DATABASE_URL in .env to a database whose name ends in "_test",\n' +
        'or set DATABASE_URL to the development database and the test database\n' +
        'name is derived from it.',
    );
  }

  const url = new URL(base);

  if (!databaseNameOf(url.toString()).endsWith('_test')) {
    url.pathname = `/${DEFAULT_TEST_DATABASE}`;
  }

  const derived = normaliseTestUrl(url.toString());
  assertTestDatabaseName(derived, 'the derived test database URL');
  return derived;
}

/**
 * The environment a test run needs: both database variables point at the test
 * database, and the timeouts are raised for a hosted provider that is slow to
 * create a scratch database and may drop a connection mid-test.
 */
export function testDatabaseEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const url = resolveTestDatabaseUrl(env);
  const next: NodeJS.ProcessEnv = { ...env, DATABASE_URL: url, DATABASE_ADMIN_URL: url };

  if (!isLocalHost(new URL(url).hostname)) {
    next['VITEST_TEST_TIMEOUT'] ??= '120000';
    next['VITEST_HOOK_TIMEOUT'] ??= '180000';
    next['VITEST_RETRY'] ??= '1';
  }

  return next;
}
