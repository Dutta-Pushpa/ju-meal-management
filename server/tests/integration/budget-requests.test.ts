import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';
import { currentDhakaMonth } from '../../src/utils/dhaka-month.js';

const PASSWORD = 'RequestPass123!';
const config: AppConfig = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/ju_meal_test',
  DATABASE_ADMIN_URL: undefined,
  DB_POOL_MAX: 5,
  DB_POOL_IDLE_TIMEOUT_MS: 30_000,
  DB_CONNECTION_TIMEOUT_MS: 5_000,
  DB_SSL: false,
  JWT_SECRET: 'integration-test-secret-long-enough-32-chars',
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
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  silent: () => undefined,
} as unknown as Logger;

let app: Express;
let db: Database;
let adminToken: string;
let teacherToken: string;
let teacher2Token: string;
let teacherId: number;
let teacher2Id: number;

async function seedUser(
  email: string,
  role: 'ADMIN' | 'STAFF' | 'TEACHER',
  permissions: string[] = [],
): Promise<number> {
  const { hashPassword } = await import('../../src/utils/password.js');
  const rows = await query<{ id: number }>(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [email.split('@')[0], email, await hashPassword(PASSWORD, 10), role, JSON.stringify(permissions)],
  );
  return rows[0]!.id;
}

async function login(email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });
  await seedUser('admin@juniv.edu', 'ADMIN');
  teacherId = await seedUser('request-teacher@juniv.edu', 'TEACHER');
  teacher2Id = await seedUser('request-teacher2@juniv.edu', 'TEACHER');
  adminToken = await login('admin@juniv.edu');
  teacherToken = await login('request-teacher@juniv.edu');
  teacher2Token = await login('request-teacher2@juniv.edu');
});

afterAll(async () => {
  await closePool();
});

describe('budget requests', () => {
  it('rejects invalid payloads', async () => {
    const badType = await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacherToken))
      .send({ requestType: 'free_money', amountPaisa: 100, reason: 'why not' });
    expect(badType.status).toBe(400);

    const badAmount = await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacherToken))
      .send({ requestType: 'budget_increase', amountPaisa: 0, reason: 'more' });
    expect(badAmount.status).toBe(400);

    const noReason = await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacherToken))
      .send({ requestType: 'budget_increase', amountPaisa: 100 });
    expect(noReason.status).toBe(400);
  });

  it('lets a teacher submit a budget increase request', async () => {
    const response = await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacherToken))
      .send({ requestType: 'budget_increase', amountPaisa: 25000, reason: 'Guest students next week' });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      requestType: 'budget_increase',
      status: 'pending',
      reason: 'Guest students next week',
    });
    expect(response.body.data.amount.amountPaisa).toBe(25000);
    expect(response.body.data.teacher.id).toBe(teacherId);
  });

  it('hides other teachers requests from the list', async () => {
    await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacher2Token))
      .send({ requestType: 'debt_allowance', amountPaisa: 10000, reason: 'Conference week' });

    const mine = await request(app)
      .get('/api/teacher/budget-requests')
      .set(auth(teacherToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].teacher.id).toBe(teacherId);
  });

  it('prevents teachers from deciding requests', async () => {
    const inbox = await request(app).get('/api/staff/budget-requests').set(auth(teacherToken));
    expect(inbox.status).toBe(403);

    const decision = await request(app)
      .post('/api/staff/budget-requests/1/decision')
      .set(auth(teacherToken))
      .send({ decision: 'approved' });
    expect(decision.status).toBe(403);
  });

  it('surfaces pending requests in the admin inbox', async () => {
    const inbox = await request(app)
      .get('/api/staff/budget-requests?status=pending')
      .set(auth(adminToken));
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toHaveLength(2);
    expect(inbox.body.data.every((r: { status: string }) => r.status === 'pending')).toBe(true);
  });

  it('rejecting records the decision without touching the ledger', async () => {
    const list = await query<{ id: number }>(
      `SELECT id FROM budget_requests WHERE teacher_id = $1 AND request_type = 'debt_allowance'`,
      [teacher2Id],
    );
    const id = list[0]!.id;
    const response = await request(app)
      .post(`/api/staff/budget-requests/${id}/decision`)
      .set(auth(adminToken))
      .send({ decision: 'rejected', note: 'Not this month' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('rejected');

    const allowance = await query<{ debt_allowance_paisa: number }>(
      `SELECT debt_allowance_paisa FROM users WHERE id = $1`,
      [teacher2Id],
    );
    expect(Number(allowance[0]!.debt_allowance_paisa)).toBe(0);

    const again = await request(app)
      .post(`/api/staff/budget-requests/${id}/decision`)
      .set(auth(adminToken))
      .send({ decision: 'approved' });
    expect(again.status).toBe(400);
  });

  it('approving a budget increase writes a signed adjustment for the current month', async () => {
    const { year, month } = currentDhakaMonth();
    const before = await query<{ amount_paisa: number }>(
      `SELECT COALESCE(sum(amount_paisa), 0)::bigint AS amount_paisa FROM budget_ledger
        WHERE teacher_id = $1 AND year = $2 AND month = $3`,
      [teacherId, year, month],
    );
    const beforePaisa = Number(before[0]!.amount_paisa);

    const list = await query<{ id: number }>(
      `SELECT id FROM budget_requests WHERE teacher_id = $1 AND request_type = 'budget_increase'`,
      [teacherId],
    );
    const id = list[0]!.id;
    const response = await request(app)
      .post(`/api/staff/budget-requests/${id}/decision`)
      .set(auth(adminToken))
      .send({ decision: 'approved' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('approved');
    expect(response.body.data.decidedBy.id).not.toBeNull();

    const after = await query<{ amount_paisa: number }>(
      `SELECT COALESCE(sum(amount_paisa), 0)::bigint AS amount_paisa FROM budget_ledger
        WHERE teacher_id = $1 AND year = $2 AND month = $3`,
      [teacherId, year, month],
    );
    expect(Number(after[0]!.amount_paisa)).toBe(beforePaisa + 25000);

    const adjustment = await query<{ entry_type: string; amount_paisa: number }>(
      `SELECT entry_type, amount_paisa FROM budget_ledger
        WHERE teacher_id = $1 AND year = $2 AND month = $3 AND entry_type = 'adjustment'`,
      [teacherId, year, month],
    );
    expect(adjustment).toHaveLength(1);
    expect(Number(adjustment[0]!.amount_paisa)).toBe(25000);
  });

  it('approving a debt allowance raises the personal debt headroom', async () => {
    await request(app)
      .post('/api/teacher/budget-requests')
      .set(auth(teacher2Token))
      .send({ requestType: 'debt_allowance', amountPaisa: 15000, reason: 'Second allowance' });
    const list = await query<{ id: number }>(
      `SELECT id FROM budget_requests WHERE teacher_id = $1 AND request_type = 'debt_allowance' AND status = 'pending'`,
      [teacher2Id],
    );
    const id = list[0]!.id;
    const response = await request(app)
      .post(`/api/staff/budget-requests/${id}/decision`)
      .set(auth(adminToken))
      .send({ decision: 'approved' });
    expect(response.status).toBe(200);

    const allowance = await query<{ debt_allowance_paisa: number }>(
      `SELECT debt_allowance_paisa FROM users WHERE id = $1`,
      [teacher2Id],
    );
    expect(Number(allowance[0]!.debt_allowance_paisa)).toBe(15000);
  });

  it('returns 404 for an unknown request id', async () => {
    const response = await request(app)
      .post('/api/staff/budget-requests/99999/decision')
      .set(auth(adminToken))
      .send({ decision: 'approved' });
    expect(response.status).toBe(404);
  });
});
