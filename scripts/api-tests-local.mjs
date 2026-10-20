// Runs the Postman collection against an API that this script boots itself.
//
// The collection writes data, so it must never be pointed at a development or
// production database by accident. This script therefore resolves the test
// database the same way the integration suite does, prepares it, starts the API
// on it, waits for it to become healthy, runs the collection, and stops the
// API again.
//
// The resolution comes from server/tests/helpers/test-database-url.ts, which is
// TypeScript, so the script is run through the tsx loader.
//
// Usage:
//   npm run test:api:local
//   npm run test:api:local -- phase5
//
// `npm run test:api` still runs the collection against an API that is already
// running, which is what CI does.

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import {
  ADMIN_DATABASE,
  databaseNameOf,
  resolveTestDatabaseUrl,
} from '../server/tests/helpers/test-database-url.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Whether something is already listening on a port. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) });

    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  // The helper reads the connection string from the environment, so the
  // repo-root .env has to be loaded first.
  loadDotenv({ path: path.join(root, '.env') });

  const testUrl = resolveTestDatabaseUrl(process.env);
  const testDatabase = databaseNameOf(testUrl);

  const port = process.env['PORT'] ?? '4000';
  const baseUrl = `http://localhost:${port}`;

  // The collection is a test client, not a real user, and it makes far more
  // requests in a minute than any human would. The default budget of 300
  // requests per 15 minutes is exhausted by a single run, which would fail the
  // suite with spurious 429s rather than testing the API contract.
  const env = {
    ...process.env,
    DATABASE_URL: testUrl,
    DATABASE_ADMIN_URL: testUrl,
    NODE_ENV: 'test',
    PORT: port,
    RATE_LIMIT_MAX_REQUESTS: process.env['RATE_LIMIT_MAX_REQUESTS'] ?? '5000',
    RATE_LIMIT_WINDOW_MINUTES: process.env['RATE_LIMIT_WINDOW_MINUTES'] ?? '1',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: process.env['LOGIN_RATE_LIMIT_MAX_ATTEMPTS'] ?? '50',
  };

  /** Run a script and wait for it. The exit code is the result. */
  function run(args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env,
        stdio: 'inherit',
        ...options,
      });

      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

  /** Create the test database when it is missing. */
  async function createDatabaseIfMissing() {
    const adminUrl = new URL(testUrl);
    adminUrl.pathname = `/${ADMIN_DATABASE}`;

    const admin = new Client({
      connectionString: adminUrl.toString(),
      application_name: 'ju-meal-api-tests',
    });

    await admin.connect();

    try {
      const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        testDatabase,
      ]);

      if (existing.rows.length > 0) {
        return;
      }

      await admin.query(`CREATE DATABASE "${testDatabase}"`);
      console.log(`Created test database "${testDatabase}".`);
    } catch (error) {
      const code = error?.code;
      const message = error instanceof Error ? error.message : String(error);

      if (
        code === '42501' ||
        code === 'EPERM' ||
        /permission denied|insufficient privilege/i.test(message)
      ) {
        console.error(
          `\nThe database role may not create databases, so "${testDatabase}" was not created.\n` +
            'Create it by hand (in Neon: Databases -> New Database) and run this command again.\n',
        );
        process.exitCode = 1;
        return;
      }

      throw error;
    } finally {
      await admin.end();
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Wait until the API answers on its health endpoint. */
  async function waitForHealth(timeoutMs, api) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (api.exitCode !== null) {
        throw new Error(`The API exited with code ${api.exitCode} before it became healthy.`);
      }

      try {
        const response = await fetch(`${baseUrl}/health`);

        if (response.ok) {
          return true;
        }
      } catch {
        // The server is not listening yet.
      }

      await delay(1000);
    }

    return false;
  }

  console.log(`Test database: ${testDatabase}\n`);

  await createDatabaseIfMissing();

  const migrate = await run(['--import', 'tsx/esm', 'db/migrate.ts']);
  if (migrate !== 0) {
    console.error('\nMigrations failed against the test database.\n');
    process.exitCode = migrate;
    return;
  }

  const seed = await run(['--import', 'tsx/esm', 'db/seed.ts']);
  if (seed !== 0) {
    console.error('\nSeeding failed against the test database.\n');
    process.exitCode = seed;
    return;
  }

  // Another API on the same port would answer the health check and the
  // collection would run against that one instead, which is exactly the
  // mistake this script exists to prevent.
  if (await isPortInUse(port)) {
    console.error(
      `\nPort ${port} is already in use, so the API cannot be started for this run.\n` +
        'Stop the other API first, or set PORT to a free port.\n',
    );
    process.exitCode = 1;
    return;
  }

  const api = spawn(process.execPath, ['--import', 'tsx/esm', 'server/src/server.ts'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  try {
    if (!(await waitForHealth(60_000, api))) {
      console.error('\nThe API did not become healthy within 60s.\n');
      process.exitCode = 1;
      return;
    }

    const collection = await run(['scripts/api-tests.mjs', ...process.argv.slice(2)], {
      env: { ...env, API_BASE_URL: baseUrl },
    });

    if (collection !== 0) {
      process.exitCode = collection;
    }
  } finally {
    api.kill();
  }
}

// Only run when this file is the entry point, so importing it has no effect.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
