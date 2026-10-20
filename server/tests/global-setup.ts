import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { applyMigrations, readMigrations } from '../../db/migrate.js';
import {
  ADMIN_DATABASE,
  databaseNameOf,
  resolveTestDatabaseUrl,
} from './helpers/test-database-url.js';

// Load the repo-root .env before reading DATABASE_URL. Vitest runs globalSetup
// before the per-file setup files, so this cannot rely on tests/setup.ts having
// loaded it. The path is resolved from this module because the cwd is server/,
// where there is no .env.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/**
 * Vitest global setup.
 *
 * Points the run at the test database, creates it if it does not exist, and
 * migrates it, so a test never fails because nobody remembered to run the
 * migrations, and a new checkout works with a single `npm test`.
 *
 * The safety guard matters more than the convenience: this connects to whatever
 * `DATABASE_URL` names, and a mistyped URL that pointed at a development or
 * production database would rewrite its schema.
 */
export async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  const name = databaseNameOf(url);

  // The workers read the connection string from the environment.
  process.env['DATABASE_URL'] = url;
  process.env['DATABASE_ADMIN_URL'] = url;

  await createDatabaseIfMissing(url);

  const client = new Client({ connectionString: url, application_name: 'ju-meal-test-setup' });
  await client.connect();

  try {
    const result = await applyMigrations(client, await readMigrations());

    if (result.applied.length > 0) {
      console.log(`\nMigrated test database "${name}": ${result.applied.join(', ')}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Create the test database when it is missing.
 *
 * `CREATE DATABASE` cannot run inside the database being created, so the
 * statement is issued from the maintenance database instead.
 */
async function createDatabaseIfMissing(url: string): Promise<void> {
  const name = databaseNameOf(url);

  const adminUrl = new URL(url);
  adminUrl.pathname = `/${ADMIN_DATABASE}`;

  const admin = new Client({
    connectionString: adminUrl.toString(),
    application_name: 'ju-meal-test-setup',
  });

  await admin.connect();

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (existing.rows.length > 0) {
      return;
    }

    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`Created test database "${name}".`);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);

    if (
      code === '42501' ||
      code === 'EPERM' ||
      /permission denied|insufficient privilege/i.test(message)
    ) {
      throw new Error(
        `The database role may not create databases, so "${name}" was not created.\n` +
          'Create it by hand (in Neon: Databases -> New Database) and run this\n' +
          'command again.',
        { cause: error },
      );
    }

    throw error;
  } finally {
    await admin.end();
  }
}
