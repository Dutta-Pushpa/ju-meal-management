import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { Client } from 'pg';
import { loadConfig } from '../server/src/config/env.js';
import { resolveConnectionString } from './migrate.js';

/**
 * Seed runner.
 *
 * Loads fictional demonstration data so a fresh checkout has something to show
 * without anyone having to type rows in by hand. Safe to run repeatedly: each
 * file truncates the demo tables first, so the same command always produces the
 * same result.
 *
 * Password hashes are generated here rather than committed. A hash in the
 * repository is a credential waiting to be lifted, and a bcrypt hash generated
 * on demand also lets the cost factor follow BCRYPT_COST.
 *
 * Usage:
 *   npm run db:seed
 */

const SEEDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seeds');

/** The documented development credentials. Never reuse these in production. */
const DEMO_PASSWORDS = {
  admin: 'AdminPass123!',
  staff: 'StaffPass123!',
  teacher: 'TeacherPass123!',
} as const;

/**
 * Generated hashes, keyed by the placeholder names used in the seed SQL.
 *
 * A bcrypt hash cannot be passed as a bound parameter here, because this file
 * contains several statements and Postgres rejects a multi-statement string on
 * the extended query protocol. It is therefore substituted as an escaped SQL
 * literal. That is safe because the value comes from bcrypt's own output
 * alphabet, which contains no quotes or backslashes, and the escape below
 * neutralises quotes regardless.
 */
async function hashAll(): Promise<Record<string, string>> {
  const result = loadConfig();

  if (!result.ok) {
    throw new Error(
      `Cannot seed: invalid configuration\n${result.issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
  }

  const cost = result.config.BCRYPT_COST;

  // bcrypt is deliberately slow, so the three hashes are produced together
  // rather than sequentially.
  const [admin, staff, teacher] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORDS.admin, cost),
    bcrypt.hash(DEMO_PASSWORDS.staff, cost),
    bcrypt.hash(DEMO_PASSWORDS.teacher, cost),
  ]);

  return {
    admin_password_hash: admin,
    staff_password_hash: staff,
    teacher_password_hash: teacher,
  };
}

/** Wrap a value as a single-quoted SQL literal, doubling any quote it contains. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Substitute the `:name` placeholders with escaped literals.
 *
 * Only known placeholder names are replaced, so ordinary SQL text and comments
 * are never touched. Any remaining placeholder ending in `_hash` is reported as
 * an error: a silently dropped hash would create an account nobody can log
 * into, which is a confusing failure to debug later.
 */
function substitute(sql: string, values: Record<string, string>): string {
  const names = Object.keys(values);

  const result = sql.replace(/:([a-z_]+)\b/g, (match, token: string) =>
    names.includes(token) ? sqlLiteral(values[token] as string) : match,
  );

  const leftover = /:[a-z_]+_hash\b/.exec(result);

  if (leftover) {
    throw new Error(
      `Seed SQL references an unknown placeholder "${leftover[0]}". ` +
        `Known placeholders are: ${names.join(', ')}.`,
    );
  }

  return result;
}

async function seed(): Promise<void> {
  const result = loadConfig();

  if (!result.ok) {
    console.error(
      `Cannot seed: invalid configuration\n${result.issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }

  const config = result.config;

  // Seed through the direct connection, the same one migrations use. Seeding
  // runs multi-statement SQL inside a single transaction, so it must not go
  // through a transaction pooler such as Neon's pooled endpoint.
  const connectionString = resolveConnectionString(config);

  // Seeding writes demo data into whatever database the connection string
  // points at. A guard is cheap insurance against wiping the wrong one.
  if (config.NODE_ENV === 'production') {
    console.error(
      'Refusing to seed with NODE_ENV=production. ' +
        'The seed replaces every row in the demo tables.',
    );
    process.exitCode = 1;
    return;
  }

  const databaseName = (() => {
    try {
      return new URL(connectionString).pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  })();

  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const hashes = await hashAll();

  const client = new Client({
    connectionString,
    application_name: 'ju-meal-seed',
  });

  await client.connect();

  try {
    console.log(`Seeding database "${databaseName}":\n`);

    for (const filename of files) {
      const sql = await readFile(path.join(SEEDS_DIR, filename), 'utf8');
      const startedAt = process.hrtime.bigint();

      // One transaction per file. A failing seed leaves the database untouched
      // rather than half populated.
      await client.query('BEGIN');

      try {
        await client.query(substitute(sql, hashes));
        await client.query('COMMIT');

        const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
        console.log(`  applied  ${filename}  (${ms}ms)`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  FAILED   ${filename}`);
        throw error;
      }
    }

    console.log('\nSeed complete. All data is fictional demonstration data.');
    console.log('\nDemo accounts:');
    console.log(`  ADMIN    admin@example.edu    ${DEMO_PASSWORDS.admin}`);
    console.log(`  STAFF    staff@example.edu    ${DEMO_PASSWORDS.staff}`);
    console.log(`  TEACHER  teacher@example.edu  ${DEMO_PASSWORDS.teacher}`);
    console.log('\nChange or delete these before any real deployment.');
  } catch (error) {
    console.error('\nSeed failed.\n');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await seed();
