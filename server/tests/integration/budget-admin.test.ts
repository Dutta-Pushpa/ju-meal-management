import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';

const PASSWORD = 'BudgetPass123!';
const config: AppConfig = {
  NODE_ENV: 'test', PORT: 4000, DATABASE_URL: 'postgresql://user:pass@localhost:5432/ju_meal_test',
  DATABASE_ADMIN_URL: undefined, DB_POOL_MAX: 5, DB_POOL_IDLE_TIMEOUT_MS: 30_000,
  DB_CONNECTION_TIMEOUT_MS: 5_000, DB_SSL: false,
  JWT_SECRET: 'integration-test-secret-long-enough-32-chars', JWT_EXPIRES_IN_MINUTES: 15,
  BCRYPT_COST: 10, APP_TIMEZONE: 'Asia/Dhaka', ORDER_CUTOFF_TIME: '12:00', BUDGET_ROLLOVER: false,
  DEFAULT_WEEKLY_BUDGET_PAISA: 70_000, CORS_ORIGIN: ['http://localhost:5173'], TRUST_PROXY: false,
  RATE_LIMIT_WINDOW_MINUTES: 15, RATE_LIMIT_MAX_REQUESTS: 300, LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
  LOG_LEVEL: 'silent', LOG_PRETTY: false,
};
const silentLogger = {
  fatal: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined,
  debug: () => undefined, trace: () => undefined, silent: () => undefined,
} as unknown as Logger;

let app: Express;
let db: Database;
let adminToken: string;
let allocatorToken: string;
let adjusterToken: string;
let teacherToken: string;
let teacherId: number;
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

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

async function createPeriod(token: string, name: string, startsOn: string, endsOn: string) {
  return request(app)
    .post('/api/staff/budget-periods')
    .set(auth(token))
    .send({ name, startsOn, endsOn });
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });
  await seedUser('admin@example.edu', 'ADMIN');
  await seedUser('allocator@example.edu', 'STAFF', ['budgets:allocate']);
  await seedUser('adjuster@example.edu', 'STAFF', ['budgets:adjust']);
  teacherId = await seedUser('teacher@example.edu', 'TEACHER');
  adminToken = await login('admin@example.edu');
  allocatorToken = await login('allocator@example.edu');
  adjusterToken = await login('adjuster@example.edu');
  teacherToken = await login('teacher@example.edu');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

describe('POST /api/staff/budget-periods', () => {
  it('requires the allocation permission and rejects invalid or overlapping dates', async () => {
    const denied = await createPeriod(teacherToken, unique('Denied'), '2090-01-01', '2090-01-07');
    expect(denied.status).toBe(403);
    const invalid = await createPeriod(adminToken, unique('Invalid'), '2090-02-30', '2090-03-01');
    expect(invalid.status).toBe(400);

    const created = await createPeriod(allocatorToken, unique('Period'), '2090-01-01', '2090-01-07');
    expect(created.status).toBe(201);
    const overlap = await createPeriod(adminToken, unique('Overlap'), '2090-01-07', '2090-01-12');
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('BUDGET_PERIOD_ALREADY_EXISTS');
  });

  it('carries positive unused balance into the next period when rollover is enabled', async () => {
    const previous = await createPeriod(adminToken, unique('Rollover source'), '2092-04-01', '2092-04-07');
    expect(previous.status).toBe(201);
    const previousId = previous.body.data.id as number;
    const allocated = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(allocatorToken))
      .send({ teacherId, budgetPeriodId: previousId, amountPaisa: 50000, reason: 'source allocation' });
    expect(allocated.status).toBe(201);
    await request(app).post('/api/staff/budgets/adjustments').set(auth(adjusterToken)).send({
      teacherId, budgetPeriodId: previousId, amountPaisa: -10000, reason: 'source spending',
    });
    const setting = await request(app).patch('/api/staff/settings/budget_rollover')
      .set(auth(adminToken)).send({ value: true });
    expect(setting.status).toBe(200);

    const next = await createPeriod(adminToken, unique('Rollover destination'), '2092-04-08', '2092-04-14');
    expect(next.status).toBe(201);
    expect(next.body.data.rolledOverAmountPaisa).toBe(40000);
    const entries = await query<{ amount_paisa: number; entry_type: string; reason: string }>(
      `SELECT amount_paisa, entry_type, reason FROM budget_ledger
        WHERE teacher_id = $1 AND budget_period_id = $2`,
      [teacherId, next.body.data.id],
    );
    expect(entries).toEqual([expect.objectContaining({
      amount_paisa: 40000, entry_type: 'adjustment', reason: expect.stringContaining('Rollover source'),
    })]);
    await request(app)
      .patch('/api/staff/settings/budget_rollover')
      .set(auth(adminToken))
      .send({ value: false });
    const following = await createPeriod(
      adminToken,
      unique('No rollover destination'),
      '2092-04-15',
      '2092-04-21',
    );
    expect(following.status).toBe(201);
    expect(following.body.data.rolledOverAmountPaisa).toBe(0);
    expect(await query(
      `SELECT id FROM budget_ledger WHERE teacher_id = $1 AND budget_period_id = $2`,
      [teacherId, following.body.data.id],
    )).toHaveLength(0);
  });
});

describe('budget allocations and adjustments', () => {
  it('writes an allocation and matching ledger credit atomically and rejects duplicates', async () => {
    const period = await createPeriod(adminToken, unique('Allocation period'), '2090-02-01', '2090-02-07');
    expect(period.status).toBe(201);
    const budgetPeriodId = period.body.data.id as number;
    const body = {
      teacherId, budgetPeriodId, amountPaisa: 70000, reason: 'weekly allocation',
    };
    const created = await request(app).post('/api/staff/budgets/allocations')
      .set(auth(allocatorToken)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.allocation.amount).toEqual({
      amountPaisa: 70000, amountFormatted: '৳700.00',
    });
    expect(created.body.data.ledgerEntry).toMatchObject({
      teacherId, budgetPeriodId, entryType: 'allocation', reason: body.reason,
    });

    const ledger = await request(app)
      .get(`/api/staff/budgets/ledger?teacherId=${teacherId}&period=${budgetPeriodId}&page=1&perPage=10`)
      .set(auth(adminToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta).toEqual({ total: 1, page: 1, perPage: 10 });
    expect(ledger.body.data[0]).toMatchObject({
      teacherId, budgetPeriodId, entryType: 'allocation', amount: { amountPaisa: 70000 },
    });
    const ledgerDenied = await request(app)
      .get(`/api/staff/budgets/ledger?teacherId=${teacherId}&period=${budgetPeriodId}`)
      .set(auth(adjusterToken));
    expect(ledgerDenied.status).toBe(403);

    const duplicate = await request(app).post('/api/staff/budgets/allocations')
      .set(auth(adminToken)).send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_ALLOCATION');
    expect(await query('SELECT id FROM budget_ledger WHERE teacher_id = $1 AND budget_period_id = $2', [
      teacherId, budgetPeriodId,
    ])).toHaveLength(1);
  });

  it('writes signed, reasoned adjustments and rejects zero or missing reasons', async () => {
    const period = await createPeriod(adminToken, unique('Adjustment period'), '2090-03-01', '2090-03-07');
    expect(period.status).toBe(201);
    const body = { teacherId, budgetPeriodId: period.body.data.id as number, amountPaisa: -5000 };
    const noReason = await request(app).post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken)).send(body);
    expect(noReason.status).toBe(400);
    const zero = await request(app).post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken)).send({ ...body, amountPaisa: 0, reason: 'invalid zero' });
    expect(zero.status).toBe(400);

    const adjusted = await request(app).post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken)).send({ ...body, reason: 'correction' });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.data).toMatchObject({
      teacherId, budgetPeriodId: body.budgetPeriodId, entryType: 'adjustment',
      amount: { amountPaisa: -5000, amountFormatted: '-৳50.00' }, reason: 'correction',
    });
  });

  it('returns ledger-derived teacher totals and a scoped, newest-first paginated ledger', async () => {
    const period = await createPeriod(adminToken, unique('Read period'), '2091-01-01', '2091-01-07');
    expect(period.status).toBe(201);
    const periodId = period.body.data.id as number;
    const allocation = await request(app).post('/api/staff/budgets/allocations')
      .set(auth(allocatorToken))
      .send({ teacherId, budgetPeriodId: periodId, amountPaisa: 10000, reason: 'weekly allocation' });
    expect(allocation.status).toBe(201);
    await query(
      `INSERT INTO budget_ledger (teacher_id, budget_period_id, entry_type, amount_paisa, reason, created_by)
       VALUES ($1, $2, 'debit', -3500, 'order', $3), ($1, $2, 'refund', 500, 'cancelled order', $3)`,
      [teacherId, periodId, teacherId],
    );

    const summary = await request(app).get(`/api/teacher/budget?period=${periodId}`)
      .set(auth(teacherToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      allocated: { amountPaisa: 10000 }, spent: { amountPaisa: 3500 },
      refunded: { amountPaisa: 500 }, available: { amountPaisa: 7000 },
    });

    const ledger = await request(app)
      .get(`/api/teacher/budget/ledger?period=${periodId}&page=1&perPage=2`)
      .set(auth(teacherToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta).toEqual({ total: 3, page: 1, perPage: 2 });
    expect(ledger.body.data).toHaveLength(2);
    expect(ledger.body.data[0].entryType).toBe('refund');

    const override = await request(app)
      .get(`/api/teacher/budget?period=${periodId}&teacherId=${teacherId + 1}`)
      .set(auth(teacherToken));
    expect(override.status).toBe(403);
    const staffRead = await request(app)
      .get(`/api/teacher/budget?period=${periodId}&teacherId=${teacherId}`)
      .set(auth(adminToken));
    expect(staffRead.status).toBe(200);
  });
});
