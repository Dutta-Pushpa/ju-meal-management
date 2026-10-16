import { Client, Pool } from 'pg';
// The int8 parser is process-wide; importing it here makes the test pool return
// money as numbers, exactly as the application pool does.
import '../../src/db/int8.js';

/**
 * Test database access.
 *
 * Integration tests run against a real PostgreSQL instance, because the rules
 * they verify are transaction and constraint behaviour, which a fake cannot
 * reproduce.
 *
 * The guard below is the important part. A typo in DATABASE_URL that pointed at
 * a development or production database would truncate real data, so a run that
 * is not clearly a test database fails immediately rather than proceeding.
 */

export const ADMIN_DATABASE = 'postgres';

function databaseNameFrom(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

function assertTestDatabase(databaseUrl: string): string {
  const name = databaseNameFrom(databaseUrl);

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against database "${name || '(unparseable URL)'}". ` +
        'DATABASE_URL must point at a dedicated database whose name ends in "_test".',
    );
  }

  return name;
}

let pool: Pool | undefined;

/** A shared pool for the test database. */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set. Integration tests need a test database.');
  }

  assertTestDatabase(url);

  pool = new Pool({ connectionString: url, application_name: 'ju-meal-test', max: 5 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, values);
  return rows[0];
}

export async function count(table: string, where = 'TRUE'): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE ${where}`,
  );
  return Number(row?.count ?? 0);
}

/**
 * Run `fn` inside a transaction that is always rolled back, so a test cannot
 * leave state behind for the next one.
 *
 * Note that this cannot observe real concurrent behaviour, because everything
 * happens inside one transaction. Tests for row locking use {@link withClients}
 * instead.
 */
export async function inTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` with several independent connections, so real concurrency and real
 * row locking are observable.
 */
export async function withClients<T>(
  count: number,
  fn: (clients: Client[]) => Promise<T>,
): Promise<T> {
  const clients = await Promise.all(
    Array.from({ length: count }, async () => {
      const client = await getPool().connect();
      await client.query('BEGIN');
      return client;
    }),
  );

  try {
    return await fn(clients);
  } finally {
    for (const client of clients) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }
}

/** Remove all rows so a test starts from a known state. */
export async function truncateAll(): Promise<void> {
  await query(`
    TRUNCATE TABLE
      order_status_events, order_items, budget_ledger, budget_allocations,
      orders, menu_items, budget_periods, food_locations, sessions,
      audit_logs, users
    RESTART IDENTITY CASCADE
  `);

  // CASCADE follows every foreign key pointing at the truncated tables, which
  // includes app_settings.updated_by, so the wipe above empties it as well. The
  // defaults are restored here for the same reason the seed file restores them.
  await query(`
    INSERT INTO app_settings (key, value, description) VALUES
      ('order_cutoff_time', '"12:00"', 'Daily ordering cutoff.'),
      ('budget_rollover', 'false', 'When false, unspent budget does not carry over.'),
      ('timezone', '"Asia/Dhaka"', 'Timezone for business dates and the cutoff.'),
      ('ordering_disabled_dates', '[]', 'Dates on which ordering is disabled.')
    ON CONFLICT (key) DO NOTHING
  `);
}

/**
 * Advance a sequence past the rows currently in a table.
 *
 * Fixtures often insert rows with explicit primary keys, which does not move
 * the sequence. Without this, the next insert without an explicit key collides
 * with an existing id and fails on the primary key instead of on whatever the
 * test was actually checking.
 */
export async function syncSequence(table: string, column = 'id'): Promise<void> {
  await query(
    `SELECT setval(
       pg_get_serial_sequence('${table}', '${column}'),
       COALESCE((SELECT MAX(${column}) FROM ${table}), 0) + 1,
       false
     )`,
  );
}

export interface ScratchDatabase {
  name: string;
  url: string;
  dispose(): Promise<void>;
}

/**
 * Create a throwaway database for a test that needs to migrate from empty.
 *
 * The name is unique per call, so tests running in sequence never collide. The
 * caller must dispose of it, which drops the database.
 */
export async function createScratchDatabase(label: string): Promise<ScratchDatabase> {
  const baseUrl = process.env['DATABASE_URL'];
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  assertTestDatabase(baseUrl);

  const base = new URL(baseUrl);
  const name = `jugm_scratch_${label}_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = `/${ADMIN_DATABASE}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const scratchUrl = new URL(base.toString());
  scratchUrl.pathname = `/${name}`;

  return {
    name,
    url: scratchUrl.toString(),
    dispose: async () => {
      const cleanup = new Client({ connectionString: adminUrl.toString() });
      await cleanup.connect();
      try {
        // Force-disconnect anything still attached, then drop.
        await cleanup.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
          [name],
        );
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
