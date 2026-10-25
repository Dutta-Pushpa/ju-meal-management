import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool, type Database } from './db/pool.js';
import { createLogger } from './utils/logger.js';

// Load .env before anything reads configuration. Kept in the entry point rather
// than in the config module so that importing the config module in a test has
// no side effect.
//
// The path is resolved from this module rather than from the process cwd. The
// dev script runs as a workspace command (`npm run dev --workspace server`),
// which sets the cwd to server/, but the single .env lives at the repository
// root beside .env.example. Loading by cwd silently found no file and the
// server exited with "DATABASE_URL is required".
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

async function main(): Promise<void> {
  // Validate before anything else. A clear list of configuration problems is
  // far more useful than a crash later on the first request that needs them.
  const configResult = loadConfig();

  if (!configResult.ok) {
    process.stderr.write(
      `\nCannot start: invalid configuration\n${configResult.issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}\n\nCopy .env.example to .env and fill in the values.\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  const config = configResult.config;
  const logger = createLogger(config);

  let db: Database | null = null;

  try {
    const pool = createPool(config, logger);

    // Fail fast and loudly. Without this the process would appear healthy and
    // then reject every request for a reason nobody would notice in the logs.
    await pool.query('SELECT 1');
    logger.info({ database: 'connected' }, 'database connection established');

    db = pool;
  } catch (error) {
    logger.error({ err: error }, 'cannot reach the database at startup');
    logger.error('Check that PostgreSQL is running and DATABASE_URL is correct.');
    process.exitCode = 1;
    return;
  }

  const app = createApp({ config, logger, db });

  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, environment: config.NODE_ENV },
      'JU Meal Management API listening',
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error({ port: config.PORT }, 'port is already in use');
    } else {
      logger.error({ err: error }, 'HTTP server error');
    }
    process.exitCode = 1;
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');

    // Stop accepting connections first, then close the pool. Reversing the
    // order would reject requests that are already in flight.
    server.close((serverError) => {
      if (serverError) {
        logger.error({ err: serverError }, 'error closing HTTP server');
      }

      const closeDb = db === null ? Promise.resolve() : db.end();

      closeDb
        .then(() => {
          logger.info('shutdown complete');
          process.exit(0);
        })
        .catch((dbError: unknown) => {
          logger.error({ err: dbError }, 'error closing the database pool');
          process.exit(1);
        });
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception, shutting down');
    shutdown('uncaughtException');
  });
}

void main();
