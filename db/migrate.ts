import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';
import { Client } from 'pg';
import { loadConfig } from '../server/src/config/env.js';

/**
 * Migration runner.
 *
 * There is no ORM in this project, so migrations are plain SQL files applied in
 * filename order. This runner exists to give them the three properties an ORM
 * would otherwise provide:
 *
 *   1. Serialisation. A PostgreSQL advisory lock is held for the whole run, so
 *      two deployments starting at once cannot apply migrations simultaneously.
 *   2. Drift detection. Every applied migration records a checksum. Editing a
 *      file that has already been applied is a hard failure, not a silent
 *      divergence between environments.
 *   3. Atomicity. Each file runs inside its own transaction, so a failing
 *      migration leaves nothing half-applied.
 *
 * The functions are exported so tests can drive them against a scratch
 * database. The CLI runs them only when this file is executed directly.
 *
 * Usage:
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate:status     report what is applied and what is pending
 */

/**
 * Arbitrary but fixed key for the advisory lock. Any 64-bit integer works; it
 * only has to be stable and unlikely to collide with another application.
 */
const ADVISORY_LOCK_KEY = 8_675_309_001;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const FILENAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export type MigrationState = 'applied' | 'pending' | 'modified' | 'orphaned';

export interface MigrationStatusRow {
  filename: string;
  state: MigrationState;
}

export interface MigrationRunResult {
  applied: string[];
  alreadyApplied: string[];
  durationMs: number;
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function readMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(dir);

  const migrations = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.sql'))
      .sort()
      .map(async (filename) => {
        const match = FILENAME_PATTERN.exec(filename);

        if (!match) {
          throw new Error(
            `Migration filename "${filename}" does not match NNNN_snake_case.sql. ` +
              'The numeric prefix defines the order, so it must be four digits.',
          );
        }

        const sql = await readFile(path.join(dir, filename), 'utf8');

        return {
          name: `${match[1]}_${match[2]}`,
          filename,
          sql,
          checksum: checksumOf(sql),
        };
      }),
  );

  // Fail on a duplicated numeric prefix rather than silently applying in an
  // arbitrary order.
  const seen = new Set<string>();
  for (const migration of migrations) {
    const prefix = migration.filename.slice(0, 4);
    if (seen.has(prefix)) {
      throw new Error(
        `Duplicate migration prefix "${prefix}". ` +
          'Two migrations cannot claim the same position in the sequence.',
      );
    }
    seen.add(prefix);
  }

  return migrations;
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    )
  `);
}

interface AppliedRow {
  name: string;
  checksum: string;
}

async function readApplied(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<AppliedRow>('SELECT name, checksum FROM schema_migrations');
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

/**
 * Detect an already-applied migration whose file has since been edited.
 *
 * This is the single most valuable check in the runner. Without it, a developer
 * who tweaks a migration locally sees no error, while every other environment
 * keeps running the original SQL, and the two databases diverge silently.
 */
function findDrift(
  migrations: Migration[],
  applied: Map<string, string>,
): { migration: Migration; existingChecksum: string } | undefined {
  return migrations
    .filter((migration) => applied.has(migration.name))
    .map((migration) => ({ migration, existingChecksum: applied.get(migration.name) ?? '' }))
    .find(({ migration, existingChecksum }) => existingChecksum !== migration.checksum);
}

export class MigrationDriftError extends Error {
  constructor(public readonly filename: string) {
    super(
      `Migration "${filename}" has already been applied but its contents have changed.\n` +
        'Editing an applied migration makes environments diverge, so it is refused.\n' +
        'Revert the edit, or add a new migration that makes the intended change.',
    );
    this.name = 'MigrationDriftError';
  }
}

/**
 * Apply every pending migration, holding an advisory lock for the duration.
 *
 * Assumes it is given an already-connected client, so the caller controls the
 * connection and can run this against a scratch database.
 */
export async function applyMigrations(
  client: Client,
  migrations: Migration[],
): Promise<MigrationRunResult> {
  await ensureMigrationsTable(client);
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

  try {
    const applied = await readApplied(client);
    const drift = findDrift(migrations, applied);

    if (drift) {
      throw new MigrationDriftError(drift.migration.filename);
    }

    const pending = migrations.filter((migration) => !applied.has(migration.name));
    const startedAt = process.hrtime.bigint();
    const newlyApplied: string[] = [];

    for (const migration of pending) {
      const fileStart = process.hrtime.bigint();

      // One transaction per file. If any statement fails, the whole file rolls
      // back and nothing is recorded as applied.
      await client.query('BEGIN');

      try {
        await client.query(migration.sql);

        const durationMs = Number(process.hrtime.bigint() - fileStart) / 1e6;

        await client.query(
          'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
          [migration.name, migration.checksum, Math.round(durationMs)],
        );

        await client.query('COMMIT');
        newlyApplied.push(migration.filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration "${migration.filename}" failed and was rolled back: ` +
            (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }

    return {
      applied: newlyApplied,
      alreadyApplied: migrations
        .filter((m) => !newlyApplied.includes(m.filename))
        .map((m) => m.filename),
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    };
  } finally {
    // Release before closing, so the lock is never held by a closed session.
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // The connection is gone; PostgreSQL has already released the lock.
    }
  }
}

export async function readStatus(
  client: Client,
  migrations: Migration[],
): Promise<MigrationStatusRow[]> {
  await ensureMigrationsTable(client);
  const applied = await readApplied(client);

  const rows: MigrationStatusRow[] = migrations.map((migration) => {
    const checksum = applied.get(migration.name);

    if (checksum === undefined) {
      return { filename: migration.filename, state: 'pending' };
    }
    if (checksum !== migration.checksum) {
      return { filename: migration.filename, state: 'modified' };
    }
    return { filename: migration.filename, state: 'applied' };
  });

  // A record with no matching file means a migration was deleted from the
  // repository while still present in the database.
  const known = new Set(migrations.map((migration) => migration.name));
  for (const name of applied.keys()) {
    if (!known.has(name)) {
      rows.push({ filename: name, state: 'orphaned' });
    }
  }

  return rows;
}

/** Resolve the connection string from configuration, preferring the admin URL. */
export function resolveConnectionString(config: { DATABASE_URL: string }): string {
  return process.env['DATABASE_ADMIN_URL'] ?? config.DATABASE_URL;
}

async function connect(): Promise<Client> {
  const result = loadConfig();

  if (!result.ok) {
    throw new Error(
      `Cannot run migrations: invalid configuration\n${result.issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
  }

  const client = new Client({
    connectionString: resolveConnectionString(result.config),
    application_name: 'ju-meal-migrate',
  });

  await client.connect();
  return client;
}

async function runCli(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';

  if (command !== 'migrate' && command !== 'status') {
    console.error(`Unknown command "${command}". Use "migrate" or "status".`);
    process.exitCode = 1;
    return;
  }

  const migrations = await readMigrations();
  const client = await connect();

  try {
    if (command === 'migrate') {
      const result = await applyMigrations(client, migrations);

      if (result.applied.length === 0) {
        console.log(
          `Database is up to date. ${result.alreadyApplied.length} migration(s) applied.`,
        );
        return;
      }

      console.log(`Applying ${result.applied.length} migration(s):\n`);
      for (const filename of result.applied) {
        console.log(`  applied  ${filename}`);
      }
      console.log(`\nMigrations complete in ${Math.round(result.durationMs)}ms.`);
    } else {
      const rows = await readStatus(client, migrations);

      console.log('Status:');
      for (const row of rows) {
        const label =
          row.state === 'applied'
            ? 'applied  '
            : row.state === 'pending'
              ? 'pending  '
              : row.state === 'modified'
                ? 'MODIFIED '
                : 'ORPHANED ';
        console.log(`  ${label} ${row.filename}`);
      }

      if (rows.some((row) => row.state === 'modified')) {
        process.exitCode = 1;
      }
    }
  } finally {
    await client.end();
  }
}

// Only run the CLI when this file is the entry point, so importing it from a
// test has no side effect.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error('\nMigration failed.\n');
    console.error(error instanceof Error ? error.message : error);

    if (error instanceof Error && 'code' in error) {
      console.error(`\nDatabase error code: ${String((error as { code?: unknown }).code)}`);
    }

    process.exitCode = 1;
  }
}
