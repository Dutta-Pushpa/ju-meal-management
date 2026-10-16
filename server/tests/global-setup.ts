import { Client } from 'pg';
import { applyMigrations, readMigrations } from '../../db/migrate.js';

/**
 * Vitest global setup.
 *
 * Migrates the test database before any suite runs, so a test never fails
 * because nobody remembered to run the migrations, and so a new checkout works
 * with a single `npm test`.
 *
 * The safety guard matters more than the convenience: this connects to whatever
 * DATABASE_URL names, and a mistyped URL that pointed at a development or
 * production database would rewrite its schema.
 */
export async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        'Integration tests need a dedicated database whose name ends in "_test".\n' +
        'Create one and point DATABASE_URL at it, for example:\n' +
        '  postgresql://ju_meal:password@localhost:5432/ju_meal_test',
    );
  }

  const name = databaseNameOf(url);

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name || '(unparseable URL)'}".\n` +
        'The name must end in "_test". Migrations run for real, so pointing this at a\n' +
        'development or production database would alter its schema.',
    );
  }

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

function databaseNameOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}
