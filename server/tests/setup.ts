/**
 * Global test setup.
 *
 * Configuration is pinned here so a test run never depends on the developer's
 * shell environment, and so logging is silent by default. A failing assertion
 * prints but never stops the run, since a missing optional file is not a
 * reason to fail every suite.
 */
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { resolveTestDatabaseUrl } from './helpers/test-database-url.js';

// Load the repo-root .env explicitly. This file runs with the cwd set to
// server/ (npm runs workspace scripts there), but the single .env lives at the
// repository root beside .env.example. A bare `dotenv/config` would look in
// server/ and find nothing.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['LOG_PRETTY'] = 'false';

// The global setup already resolved this in the main process. Resolving it
// again here guarantees the worker points at the test database even if the
// environment did not carry the change across.
process.env['DATABASE_URL'] = resolveTestDatabaseUrl();
process.env['DATABASE_ADMIN_URL'] = process.env['DATABASE_URL'];
