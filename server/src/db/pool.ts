import { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';

/**
 * The narrow surface of a PostgreSQL connection that this codebase depends on.
 *
 * Depending on this rather than on the concrete `Pool` class keeps services
 * testable without a live database, and documents exactly what a model is
 * allowed to assume.
 */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** A connection checked out of the pool. Must be returned with `release()`. */
export interface TransactionClient extends Queryable {
  release(): void | Promise<void>;
}

export interface Database extends Queryable {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
}

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export function createPool(config: AppConfig, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : undefined,
    application_name: 'ju-meal-server',
  });

  // An idle client erroring out, for example when the database restarts, must
  // not take the process down. Without this handler the event is unhandled and
  // Node exits. The next checkout simply opens a fresh connection.
  pool.on('error', (error) => {
    logger.error({ err: error }, 'Idle database client error');
  });

  return pool;
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any
 * throw.
 *
 * Every multi-step financial operation in this project runs through here, so a
 * partial write can never survive: if the order insert succeeds but the ledger
 * debit fails, the order insert is rolled back with it.
 *
 * `isolation` defaults to READ COMMITTED. Order creation raises it to
 * SERIALIZABLE and additionally locks the teacher row, which is what stops two
 * simultaneous orders from both passing the balance check.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: TransactionClient) => Promise<T>,
  isolation: IsolationLevel = 'READ COMMITTED',
): Promise<T> {
  const client = await db.connect();

  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken. The server rolls back when the
      // connection closes, so there is nothing useful left to do here.
    }
    throw error;
  } finally {
    await client.release();
  }
}
