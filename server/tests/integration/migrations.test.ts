import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  MigrationDriftError,
  applyMigrations,
  checksumOf,
  readMigrations,
  readStatus,
} from '../../../db/migrate.js';
import { closePool, createScratchDatabase } from '../helpers/database.js';

/**
 * Migration runner tests.
 *
 * Every test creates a throwaway database and drops it afterwards, so the suite
 * never depends on, or damages, the shared test database.
 */

const EXPECTED_TABLES = [
  'app_settings',
  'audit_logs',
  'budget_allocations',
  'budget_ledger',
  'budget_periods',
  'food_locations',
  'menu_items',
  'order_items',
  'order_status_events',
  'orders',
  'sessions',
  'users',
];

/** Create a scratch database, run `fn` against it, then drop it. */
async function inScratchDatabase(
  label: string,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const db = await createScratchDatabase(label);
  const client = new Client({ connectionString: db.url });
  await client.connect();

  try {
    await fn(client);
  } finally {
    await client.end();
    await db.dispose();
  }
}

/** Create a temporary migrations directory and remove it after the test. */
async function inTempMigrationsDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'jugm-migrations-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('migration runner', () => {
  afterAll(async () => {
    await closePool();
  });

  it('applies cleanly to an empty database and creates every table', async () => {
    await inScratchDatabase('clean', async (client) => {
      const migrations = await readMigrations();
      const result = await applyMigrations(client, migrations);

      expect(result.applied).toEqual(migrations.map((m) => m.filename));
      expect(result.alreadyApplied).toEqual([]);

      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const actual = rows.map((row) => row.table_name);

      for (const table of EXPECTED_TABLES) {
        expect(actual).toContain(table);
      }
    });
  });

  it('records a checksum and applied time for each migration', async () => {
    await inScratchDatabase('checksum', async (client) => {
      const migrations = await readMigrations();
      await applyMigrations(client, migrations);

      const { rows } = await client.query<{ name: string; checksum: string; applied_at: Date }>(
        'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
      );

      expect(rows).toHaveLength(migrations.length);

      for (const migration of migrations) {
        const row = rows.find((r) => r.name === migration.name);
        expect(row, `no row for ${migration.name}`).toBeDefined();
        expect(row?.checksum).toBe(migration.checksum);
        expect(row?.applied_at).toBeInstanceOf(Date);
      }
    });
  });

  it('is a no-op when run again', async () => {
    await inScratchDatabase('noop', async (client) => {
      const migrations = await readMigrations();

      const first = await applyMigrations(client, migrations);
      expect(first.applied).toHaveLength(migrations.length);

      const second = await applyMigrations(client, migrations);
      expect(second.applied).toEqual([]);
      expect(second.alreadyApplied).toHaveLength(migrations.length);

      // Still exactly one record per migration, not two.
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      );
      expect(Number(rows[0]?.count)).toBe(migrations.length);
    });
  });

  it('applies only what is pending when a new migration is added', async () => {
    await inTempMigrationsDir(async (dir) => {
      await writeFile(path.join(dir, '0001_first.sql'), 'CREATE TABLE alpha (id int);');

      await inScratchDatabase('incremental', async (client) => {
        const first = await readMigrations(dir);
        expect(first).toHaveLength(1);
        await applyMigrations(client, first);

        await writeFile(path.join(dir, '0002_second.sql'), 'CREATE TABLE beta (id int);');
        const both = await readMigrations(dir);

        let status = await readStatus(client, both);
        expect(status).toEqual([
          { filename: '0001_first.sql', state: 'applied' },
          { filename: '0002_second.sql', state: 'pending' },
        ]);

        const second = await applyMigrations(client, both);
        // The already-applied file is not re-run.
        expect(second.applied).toEqual(['0002_second.sql']);
        expect(second.alreadyApplied).toEqual(['0001_first.sql']);

        status = await readStatus(client, both);
        expect(status.every((row) => row.state === 'applied')).toBe(true);

        const { rows } = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name IN ('alpha', 'beta')`,
        );
        expect(rows.map((r) => r.table_name).sort()).toEqual(['alpha', 'beta']);
      });
    });
  });

  it('refuses to run when an applied migration has been edited', async () => {
    await inTempMigrationsDir(async (dir) => {
      const filename = '0001_schema.sql';
      await writeFile(path.join(dir, filename), 'CREATE TABLE alpha (id int);');

      await inScratchDatabase('drift', async (client) => {
        await applyMigrations(client, await readMigrations(dir));

        // Someone edits the file after it has already been applied.
        await writeFile(path.join(dir, filename), 'CREATE TABLE alpha (id int, extra text);');

        await expect(applyMigrations(client, await readMigrations(dir))).rejects.toBeInstanceOf(
          MigrationDriftError,
        );

        // Nothing was applied on the failed attempt.
        const status = await readStatus(client, await readMigrations(dir));
        expect(status).toEqual([{ filename, state: 'modified' }]);
      });
    });
  });

  it('reports a migration that was applied but no longer exists on disk', async () => {
    await inTempMigrationsDir(async (dir) => {
      await writeFile(path.join(dir, '0001_only.sql'), 'CREATE TABLE alpha (id int);');

      await inScratchDatabase('orphan', async (client) => {
        await applyMigrations(client, await readMigrations(dir));

        // The file is deleted from the repository while the database keeps it.
        await rm(path.join(dir, '0001_only.sql'));

        const status = await readStatus(client, await readMigrations(dir));
        // The key recorded in the database is the migration name, not the
        // filename, so an orphaned row is reported under its name.
        expect(status).toEqual([{ filename: '0001_only', state: 'orphaned' }]);
      });
    });
  });

  it('rolls a failing migration back entirely and records nothing', async () => {
    await inTempMigrationsDir(async (dir) => {
      // The first statement succeeds, the second does not exist.
      await writeFile(
        path.join(dir, '0001_broken.sql'),
        'CREATE TABLE good_table (id int); SELECT this_function_does_not_exist();',
      );

      await inScratchDatabase('rollback', async (client) => {
        await expect(applyMigrations(client, await readMigrations(dir))).rejects.toThrow(
          /rolled back/,
        );

        const { rows } = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'good_table'`,
        );
        expect(rows).toEqual([]);

        const applied = await client.query('SELECT name FROM schema_migrations');
        expect(applied.rows).toEqual([]);
      });
    });
  });

  it('rejects a migration filename that does not follow the naming rule', async () => {
    await inTempMigrationsDir(async (dir) => {
      await writeFile(path.join(dir, 'not-a-migration.sql'), 'SELECT 1;');
      await expect(readMigrations(dir)).rejects.toThrow(/does not match/);
    });
  });

  it('rejects two migrations claiming the same sequence number', async () => {
    await inTempMigrationsDir(async (dir) => {
      await writeFile(path.join(dir, '0001_alpha.sql'), 'SELECT 1;');
      await writeFile(path.join(dir, '0001_beta.sql'), 'SELECT 1;');
      await expect(readMigrations(dir)).rejects.toThrow(/Duplicate migration prefix/);
    });
  });

  it('computes a stable checksum that changes when content changes', () => {
    const a = checksumOf('CREATE TABLE t (id int);');
    const b = checksumOf('CREATE TABLE t (id int);');
    const c = checksumOf('CREATE TABLE t (id int, name text);');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
