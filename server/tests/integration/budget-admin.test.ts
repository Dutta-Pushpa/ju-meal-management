import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';
import { currentDhakaMonth } from '../../src/utils/dhaka-month.js';

const PASSWORD = 'BudgetPass123!';
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
let allocatorToken: string;
let adjusterToken: string;
let teacherToken: string;
let teacherId: number;
let teacher2Id: number;
let teacher3Id: number;
let teacher4Id: number;
let locationId: number;
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
    [
      email.split('@')[0],
      email,
      await hashPassword(PASSWORD, 10),
      role,
      JSON.stringify(permissions),
    ],
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

/** Insert a ledger row directly (debits and refunds of test scenarios). */
async function insertLedger(
  teacher: number,
  year: number,
  month: number,
  entryType: 'debit' | 'refund',
  amountPaisa: number,
) {
  await query(
    `INSERT INTO budget_ledger (teacher_id, year, month, entry_type, amount_paisa, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $1)`,
    [teacher, year, month, entryType, amountPaisa, 'test entry'],
  );
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });
  await seedUser('admin@juniv.edu', 'ADMIN');
  await seedUser('allocator@juniv.edu', 'STAFF', ['budgets:allocate']);
  await seedUser('adjuster@juniv.edu', 'STAFF', ['budgets:adjust']);
  teacherId = await seedUser('teacher@juniv.edu', 'TEACHER');
  teacher2Id = await seedUser('teacher2@juniv.edu', 'TEACHER');
  teacher3Id = await seedUser('teacher3@juniv.edu', 'TEACHER');
  teacher4Id = await seedUser('teacher4@juniv.edu', 'TEACHER');
  locationId = (
    await query<{ id: number }>(
      `INSERT INTO food_locations (name) VALUES ('Budget Test Location') RETURNING id`,
    )
  )[0]!.id;
  adminToken = await login('admin@juniv.edu');
  allocatorToken = await login('allocator@juniv.edu');
  adjusterToken = await login('adjuster@juniv.edu');
  teacherToken = await login('teacher@juniv.edu');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

describe('POST /api/staff/budgets/allocations', () => {
  it('requires the allocation permission and writes the allocation with its ledger credit', async () => {
    const denied = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(teacherToken))
      .send({ teacherId, year: 2090, month: 1, amountPaisa: 70000, reason: 'monthly allocation' });
    expect(denied.status).toBe(403);

    const body = {
      teacherId,
      year: 2090,
      month: 1,
      amountPaisa: 70000,
      reason: 'monthly allocation',
    };
    const created = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(allocatorToken))
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.allocation).toMatchObject({
      teacherId,
      year: 2090,
      month: 1,
      amount: { amountPaisa: 70000, amountFormatted: '৳700.00' },
    });
    expect(created.body.data.ledgerEntry).toMatchObject({
      teacherId,
      budgetPeriodId: null,
      year: 2090,
      month: 1,
      entryType: 'allocation',
      reason: body.reason,
    });
  });

  it('rejects duplicates for the same teacher and month', async () => {
    const duplicate = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(adminToken))
      .send({ teacherId, year: 2090, month: 1, amountPaisa: 50000, reason: 'duplicate' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_ALLOCATION');
    expect(
      await query(
        `SELECT id FROM budget_ledger WHERE teacher_id = $1 AND year = 2090 AND month = 1`,
        [teacherId],
      ),
    ).toHaveLength(1);
  });
});

describe('POST /api/staff/budgets/adjustments', () => {
  it('writes signed, reasoned adjustments and rejects zero or missing reasons', async () => {
    const body = { teacherId, year: 2090, month: 2, amountPaisa: -5000 };
    const noReason = await request(app)
      .post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken))
      .send(body);
    expect(noReason.status).toBe(400);
    const zero = await request(app)
      .post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken))
      .send({ ...body, amountPaisa: 0, reason: 'invalid zero' });
    expect(zero.status).toBe(400);

    const adjusted = await request(app)
      .post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken))
      .send({ ...body, reason: 'correction' });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.data).toMatchObject({
      teacherId,
      year: 2090,
      month: 2,
      entryType: 'adjustment',
      amount: { amountPaisa: -5000, amountFormatted: '-৳50.00' },
      reason: 'correction',
    });
  });

  it('defaults year and month to the current Dhaka month', async () => {
    const adjusted = await request(app)
      .post('/api/staff/budgets/adjustments')
      .set(auth(adjusterToken))
      .send({ teacherId: teacher4Id, amountPaisa: 2500, reason: 'default month check' });
    expect(adjusted.status).toBe(201);
    const dhaka = currentDhakaMonth();
    expect(adjusted.body.data.year).toBe(dhaka.year);
    expect(adjusted.body.data.month).toBe(dhaka.month);
  });
});

describe('GET /api/staff/budgets/ledger', () => {
  it('returns a month-scoped, newest-first paginated ledger and guards permissions', async () => {
    const ledger = await request(app)
      .get(`/api/staff/budgets/ledger?teacherId=${teacherId}&year=2090&month=1&page=1&perPage=10`)
      .set(auth(adminToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta).toEqual({ total: 1, page: 1, perPage: 10 });
    expect(ledger.body.data[0]).toMatchObject({
      teacherId,
      year: 2090,
      month: 1,
      entryType: 'allocation',
      amount: { amountPaisa: 70000 },
    });

    // Role-only access: any staff member may read the ledger; teachers cannot.
    const ledgerAllowed = await request(app)
      .get(`/api/staff/budgets/ledger?teacherId=${teacherId}&year=2090&month=1`)
      .set(auth(adjusterToken));
    expect(ledgerAllowed.status).toBe(200);

    const teacherDenied = await request(app)
      .get(`/api/staff/budgets/ledger?teacherId=${teacherId}&year=2090&month=1`)
      .set(auth(teacherToken));
    expect(teacherDenied.status).toBe(403);

    const missingTeacher = await request(app)
      .get(`/api/staff/budgets/ledger?year=2090&month=1`)
      .set(auth(adminToken));
    expect(missingTeacher.status).toBe(400);
  });
});

describe('GET /api/staff/budgets/monthly', () => {
  it('lists every active teacher with allocation, carry-forward, and remaining balance', async () => {
    // Overspend teacher2 in 2090-02: 50000 allocated, 60000 spent, 1000
    // refunded -> remaining -9000, which must roll into 2090-03 negatively.
    const allocated = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(adminToken))
      .send({
        teacherId: teacher2Id,
        year: 2090,
        month: 2,
        amountPaisa: 50000,
        reason: 'monthly allocation',
      });
    expect(allocated.status).toBe(201);
    await insertLedger(teacher2Id, 2090, 2, 'debit', -60000);
    await insertLedger(teacher2Id, 2090, 2, 'refund', 1000);

    const february = await request(app)
      .get('/api/staff/budgets/monthly?year=2090&month=2')
      .set(auth(adminToken));
    expect(february.status).toBe(200);
    expect(february.body.meta.total).toBe(4);
    const februaryRows = february.body.data as Array<{ teacher: { id: number } }>;
    const rowsById = new Map(februaryRows.map((row) => [row.teacher.id, row]));

    const overspent = rowsById.get(teacher2Id);
    expect(overspent).toMatchObject({
      hasAllocation: true,
      allocated: { amountPaisa: 50000 },
      carryForward: { amountPaisa: 0 },
      spent: { amountPaisa: 60000 },
      refunded: { amountPaisa: 1000 },
      remaining: { amountPaisa: -9000, amountFormatted: '-৳90.00' },
    });

    // Teachers without an allocation for the month still appear, with zeros.
    const unallocated = rowsById.get(teacher3Id);
    expect(unallocated).toMatchObject({
      hasAllocation: false,
      allocated: { amountPaisa: 0 },
      remaining: { amountPaisa: 0 },
    });

    // Unused/negative budget carries into the next month automatically.
    const marchAllocation = await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(adminToken))
      .send({
        teacherId: teacher2Id,
        year: 2090,
        month: 3,
        amountPaisa: 50000,
        reason: 'next month allocation',
      });
    expect(marchAllocation.status).toBe(201);

    const march = await request(app)
      .get('/api/staff/budgets/monthly?year=2090&month=3')
      .set(auth(adminToken));
    expect(march.status).toBe(200);
    const marchData = march.body.data as Array<{ teacher: { id: number } }>;
    const marchRows = new Map(marchData.map((row) => [row.teacher.id, row]));
    expect(marchRows.get(teacher2Id)).toMatchObject({
      allocated: { amountPaisa: 50000 },
      carryForward: { amountPaisa: -9000 },
      remaining: { amountPaisa: 41000 },
    });
  });

  it('allows any staff member and denies teachers (role-only access)', async () => {
    const allowed = await request(app)
      .get('/api/staff/budgets/monthly?year=2090&month=2')
      .set(auth(adjusterToken));
    expect(allowed.status).toBe(200);
    const deniedTeacher = await request(app)
      .get('/api/staff/budgets/monthly?year=2090&month=2')
      .set(auth(teacherToken));
    expect(deniedTeacher.status).toBe(403);
  });
});

describe('GET /api/staff/budgets/transactions', () => {
  it('lists successful orders of the month with transaction ids and filters', async () => {
    await query(
      `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa, cancelled_at)
       VALUES ($1, $3, '2090-04-10', 'PENDING', 8500, NULL),
              ($1, $3, '2090-04-12', 'DELIVERED', 12000, NULL),
              ($1, $3, '2090-04-14', 'CANCELLED', 9000, now()),
              ($2, $3, '2090-04-16', 'PENDING', 4000, NULL)`,
      [teacherId, teacher2Id, locationId],
    );

    const response = await request(app)
      .get('/api/staff/budgets/transactions?year=2090&month=4')
      .set(auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ total: 3, page: 1, perPage: 50 });
    // Newest first; cancelled orders are excluded.
    const transactions = response.body.data as Array<{
      orderDate: string;
      transactionId: string;
      status: string;
    }>;
    expect(transactions.map((row) => row.orderDate)).toEqual([
      '2090-04-16',
      '2090-04-12',
      '2090-04-10',
    ]);
    for (const entry of transactions) {
      expect(entry.transactionId).toMatch(/^TXN-\d{6}$/);
      expect(entry.status).not.toBe('CANCELLED');
    }

    const filtered = await request(app)
      .get(`/api/staff/budgets/transactions?year=2090&month=4&teacherId=${teacher2Id}`)
      .set(auth(adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.meta.total).toBe(1);
    expect(filtered.body.data[0].teacher).toMatchObject({ id: teacher2Id });
    expect(filtered.body.data[0].amount).toEqual({ amountPaisa: 4000, amountFormatted: '৳40.00' });
  });
});

describe('GET /api/staff/budgets/history', () => {
  it('returns the six-month allocation window with totals', async () => {
    await request(app).post('/api/staff/budgets/allocations').set(auth(adminToken)).send({
      teacherId: teacher2Id,
      year: 2090,
      month: 1,
      amountPaisa: 20000,
      reason: 'outside window',
    });
    await request(app)
      .post('/api/staff/budgets/allocations')
      .set(auth(adminToken))
      .send({ teacherId, year: 2090, month: 6, amountPaisa: 20000, reason: 'june teacher' });
    await request(app).post('/api/staff/budgets/allocations').set(auth(adminToken)).send({
      teacherId: teacher2Id,
      year: 2090,
      month: 6,
      amountPaisa: 30000,
      reason: 'june teacher2',
    });

    const response = await request(app)
      .get('/api/staff/budgets/history?year=2090&month=6')
      .set(auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.data.anchor).toEqual({ year: 2090, month: 6 });
    expect(response.body.data.months).toHaveLength(6);
    expect(response.body.data.months[0]).toMatchObject({
      year: 2090,
      month: 1,
      label: 'January 2090',
    });
    expect(response.body.data.months[5]).toMatchObject({
      year: 2090,
      month: 6,
      label: 'June 2090',
    });
    // January is inside the window (Jan-Jun): the teacher's original 70000
    // allocation plus teacher2's 20000.
    expect(response.body.data.months[0].totalAllocated).toEqual({
      amountPaisa: 90000,
      amountFormatted: '৳900.00',
    });
    expect(response.body.data.months[5].totalAllocated).toEqual({
      amountPaisa: 50000,
      amountFormatted: '৳500.00',
    });
    // 90000 (Jan) + 50000 (Feb) + 50000 (Mar, from the monthly-table test)
    // + 50000 (Jun).
    expect(response.body.data.grandTotal).toEqual({
      amountPaisa: 240000,
      amountFormatted: '৳2400.00',
    });
  });
});

describe('GET /api/teacher/budget', () => {
  it('returns the monthly summary with carry-forward, scoped by role', async () => {
    const summary = await request(app)
      .get('/api/teacher/budget?year=2090&month=1')
      .set(auth(teacherToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      year: 2090,
      month: 1,
      period: { id: '2090-01', name: 'January 2090' },
      hasAllocation: true,
      allocated: { amountPaisa: 70000 },
      available: { amountPaisa: 70000 },
    });

    const override = await request(app)
      .get(`/api/teacher/budget?year=2090&month=1&teacherId=${teacher2Id}`)
      .set(auth(teacherToken));
    expect(override.status).toBe(403);

    const staffRead = await request(app)
      .get(`/api/teacher/budget?year=2090&month=3&teacherId=${teacher2Id}`)
      .set(auth(adminToken));
    expect(staffRead.status).toBe(200);
    // By now teacher2 also holds the 2090-01 history allocation (20000), so the
    // carry-forward is 70000 of prior allocations - 59000 of prior activity.
    expect(staffRead.body.data).toMatchObject({
      allocated: { amountPaisa: 50000 },
      carryForward: { amountPaisa: 11000 },
      available: { amountPaisa: 61000 },
    });
  });

  it('defaults to the current Dhaka month when year and month are omitted', async () => {
    const summary = await request(app)
      .get(`/api/teacher/budget?teacherId=${teacher4Id}`)
      .set(auth(adminToken));
    expect(summary.status).toBe(200);
    const dhaka = currentDhakaMonth();
    expect(summary.body.data.year).toBe(dhaka.year);
    expect(summary.body.data.month).toBe(dhaka.month);
    // The default-month adjustment written earlier is reflected.
    expect(summary.body.data.adjusted).toEqual({ amountPaisa: 2500, amountFormatted: '৳25.00' });
  });
});

describe('GET /api/teacher/budget/ledger', () => {
  it('returns the teacher’s month ledger, paginated and newest first', async () => {
    const ledger = await request(app)
      .get('/api/teacher/budget/ledger?year=2090&month=1&page=1&perPage=10')
      .set(auth(teacherToken));
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta).toEqual({ total: 1, page: 1, perPage: 10 });
    expect(ledger.body.data[0]).toMatchObject({
      teacherId,
      entryType: 'allocation',
      amount: { amountPaisa: 70000 },
    });
  });
});

describe('legacy budget periods', () => {
  it('still accepts period creation with validation and lists saved periods', async () => {
    const invalid = await createPeriod(adminToken, unique('Invalid'), '2090-02-30', '2090-03-01');
    expect(invalid.status).toBe(400);

    const created = await createPeriod(
      allocatorToken,
      unique('Period'),
      '2090-01-01',
      '2090-01-07',
    );
    expect(created.status).toBe(201);
    const overlap = await createPeriod(adminToken, unique('Overlap'), '2090-01-07', '2090-01-12');
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('BUDGET_PERIOD_ALREADY_EXISTS');

    const listed = await request(app).get('/api/teacher/budget-periods').set(auth(teacherToken));
    expect(listed.status).toBe(200);
    const periods = listed.body.data as Array<{
      name: string;
      startsOn: string;
      amountPaisa?: number;
    }>;
    expect(periods.some((period) => period.name === created.body.data.name)).toBe(true);
    expect(periods[0]).toHaveProperty('startsOn');
    expect(periods[0]).not.toHaveProperty('amountPaisa');
  });
});

describe('GET /api/staff/teachers budget permissions', () => {
  it('allows staff who can adjust budgets to load teacher choices', async () => {
    const response = await request(app).get('/api/staff/teachers').set(auth(adjusterToken));
    expect(response.status).toBe(200);
    const teachers = response.body.data as Array<{ id: number }>;
    expect(teachers.some((teacher) => teacher.id === teacherId)).toBe(true);
  });
});
