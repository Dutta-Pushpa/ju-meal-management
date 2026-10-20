import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseUrl, testDatabaseEnv } from '../helpers/test-database-url.js';

/**
 * The test connection string is resolved from configuration alone, so these
 * tests need no database. They pin the rules the rest of the workflow depends
 * on: the database name must end in `_test`, the connection must be direct,
 * and a hosted host must carry `sslmode`.
 */

const REMOTE = {
  DATABASE_URL:
    'postgresql://user:pass@ep-abc-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
} as NodeJS.ProcessEnv;

describe('resolveTestDatabaseUrl', () => {
  it('prefers TEST_DATABASE_URL over everything else', () => {
    const url = resolveTestDatabaseUrl({
      ...REMOTE,
      TEST_DATABASE_URL:
        'postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/ju_meal_test?sslmode=require',
      DATABASE_ADMIN_URL:
        'postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/neondb?sslmode=require',
    });

    expect(new URL(url).pathname).toBe('/ju_meal_test');
  });

  it('refuses a TEST_DATABASE_URL whose name does not end in _test', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/neondb',
      }),
    ).toThrow(/must end in "_test"/);
  });

  it('derives a _test database name from the development one', () => {
    const url = new URL(resolveTestDatabaseUrl(REMOTE));

    expect(url.pathname).toBe('/ju_meal_test');
  });

  it('keeps a database name that already ends in _test', () => {
    const url = new URL(
      resolveTestDatabaseUrl({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/ju_meal_test',
      }),
    );

    expect(url.pathname).toBe('/ju_meal_test');
  });

  it('uses the direct endpoint, never the pooler', () => {
    const url = new URL(resolveTestDatabaseUrl(REMOTE));

    expect(url.hostname).not.toContain('-pooler');
  });

  it('adds sslmode for a hosted host and leaves a local one alone', () => {
    const hosted = new URL(resolveTestDatabaseUrl(REMOTE));
    const local = new URL(
      resolveTestDatabaseUrl({ DATABASE_URL: 'postgresql://ju_meal:pw@localhost:5432/ju_meal' }),
    );

    expect(hosted.searchParams.get('sslmode')).toBe('require');
    expect(local.searchParams.has('sslmode')).toBe(false);
  });

  it('explains what to set when no connection string is configured', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/TEST_DATABASE_URL/);
  });
});

describe('testDatabaseEnv', () => {
  it('points both database variables at the test database', () => {
    const env = testDatabaseEnv(REMOTE);

    expect(env['DATABASE_URL']).toBe(env['DATABASE_ADMIN_URL']);
    expect(new URL(env['DATABASE_URL'] ?? '').pathname).toBe('/ju_meal_test');
  });

  it('raises the timeouts for a hosted database', () => {
    const env = testDatabaseEnv(REMOTE);

    expect(env['VITEST_TEST_TIMEOUT']).toBe('120000');
    expect(env['VITEST_RETRY']).toBe('1');
  });

  it('leaves the timeouts alone for a local database', () => {
    const env = testDatabaseEnv({
      DATABASE_URL: 'postgresql://ju_meal:pw@localhost:5432/ju_meal',
    });

    expect(env['VITEST_TEST_TIMEOUT']).toBeUndefined();
    expect(env['VITEST_RETRY']).toBeUndefined();
  });
});
