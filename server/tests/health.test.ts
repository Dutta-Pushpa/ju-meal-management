import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Logger } from '../src/utils/logger.js';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import type { Database } from '../src/db/pool.js';

/**
 * Phase 1 infrastructure tests: the health endpoint, the error envelope, and
 * the 404 path.
 *
 * These use a stub database rather than a live one. Database behaviour is
 * covered from Phase 2, once migrations exist.
 */

const testConfig: AppConfig = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/ju_meal_test',
  DATABASE_ADMIN_URL: undefined,
  DB_POOL_MAX: 2,
  DB_POOL_IDLE_TIMEOUT_MS: 30_000,
  DB_CONNECTION_TIMEOUT_MS: 5_000,
  DB_SSL: false,
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  JWT_EXPIRES_IN_MINUTES: 15,
  BCRYPT_COST: 10,
  CORS_ORIGIN: ['http://localhost:5173'],
  TRUST_PROXY: false,
  RATE_LIMIT_WINDOW_MINUTES: 15,
  RATE_LIMIT_MAX_REQUESTS: 300,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
  LOG_LEVEL: 'silent',
  LOG_PRETTY: false,
};

const silentLogger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
} as unknown as Logger;

function appWith(db: Database | null) {
  return createApp({ config: testConfig, logger: silentLogger, db });
}

/**
 * A stub database plus the underlying mock, so a test can assert on calls
 * without binding `query` out of its object.
 *
 * connect and end are present because the application asks for a Database:
 * serving an authenticated endpoint needs the pool interface, even though these
 * tests never reach one.
 */
function stubDb(behaviour: 'ok' | 'fail') {
  const query = vi.fn(() =>
    behaviour === 'ok'
      ? Promise.resolve({ rows: [{}], rowCount: 1 })
      : Promise.reject(new Error('connection refused: host=localhost user=ju_meal')),
  );

  return {
    db: {
      query,
      connect: vi.fn(),
      end: vi.fn(),
    } as unknown as Database,
    query,
  };
}

describe('GET /health', () => {
  it('reports ok and 200 when the database is reachable', async () => {
    const { db, query } = stubDb('ok');
    const res = await request(appWith(db)).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('up');
    expect(res.body.data.environment).toBe('test');
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports degraded and 503 when the database query fails', async () => {
    const { db } = stubDb('fail');
    const res = await request(appWith(db)).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.database).toBe('down');
  });

  it('reports degraded and 503 when no pool is configured', async () => {
    const res = await request(appWith(null)).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.data.database).toBe('down');
  });

  it('never leaks the connection string or the database error text', async () => {
    const secret = 'postgresql://ju_meal:super-secret-password@db.internal:5432/prod';
    const query = vi.fn(() => Promise.reject(new Error(`could not connect using ${secret}`)));
    const db = { query, connect: vi.fn(), end: vi.fn() } as unknown as Database;

    const res = await request(appWith(db)).get('/health');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('super-secret-password');
    expect(body).not.toContain('db.internal');
    expect(body).not.toContain('could not connect');
  });

  it('echoes a request id back for correlation', async () => {
    const { db } = stubDb('ok');
    const res = await request(appWith(db)).get('/health').set('X-Request-Id', 'test-correlation-1');

    expect(res.headers['x-request-id']).toBe('test-correlation-1');
  });

  it('generates a request id when the client does not send one', async () => {
    const { db } = stubDb('ok');
    const res = await request(appWith(db)).get('/health');

    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('sets hardening headers and does not advertise the framework', async () => {
    const { db } = stubDb('ok');
    const res = await request(appWith(db)).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('returns the standard error envelope for an unknown path', async () => {
    const { db } = stubDb('ok');
    const res = await request(appWith(db)).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/api/does-not-exist');
  });
});

describe('malformed request bodies', () => {
  it('rejects invalid JSON with a 400 and the error envelope', async () => {
    const { db } = stubDb('ok');
    const res = await request(appWith(db))
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBeDefined();
  });
});
