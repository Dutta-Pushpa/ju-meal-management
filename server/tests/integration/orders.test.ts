import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';

const PASSWORD = 'OrderPass123!';
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
let teacherToken: string;
let adminToken: string;
let staffToken: string;
let otherTeacherToken: string;
let teacherId: number;
let itemId: number;
let locationId: number;
let secondLocationId: number;
let secondItemId: number;

async function seedUser(
  email: string,
  role: 'TEACHER' | 'STAFF' | 'ADMIN',
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

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });
  teacherId = await seedUser('order-teacher@juniv.edu', 'TEACHER');
  await seedUser('other-teacher@juniv.edu', 'TEACHER');
  const adminId = await seedUser('order-admin@juniv.edu', 'ADMIN');
  await seedUser('order-staff@juniv.edu', 'STAFF', [
    'orders:cancel',
    'orders:manage_status',
    'budgets:view',
  ]);
  teacherToken = await login('order-teacher@juniv.edu');
  otherTeacherToken = await login('other-teacher@juniv.edu');
  adminToken = await login('order-admin@juniv.edu');
  staffToken = await login('order-staff@juniv.edu');

  await query(`INSERT INTO food_locations (name) VALUES ('Order location'), ('Other location')`);
  const locations = await query<{ id: number; name: string }>(
    `SELECT id, name FROM food_locations WHERE name IN ('Order location', 'Other location')`,
  );
  locationId = locations.find((location) => location.name === 'Order location')!.id;
  secondLocationId = locations.find((location) => location.name === 'Other location')!.id;
  await query(
    `INSERT INTO menu_items (food_location_id, name, price_paisa)
     VALUES ($1, 'Meal', 1000), ($2, 'Other meal', 2000)`,
    [locationId, secondLocationId],
  );
  const items = await query<{ id: number; name: string }>(
    `SELECT id, name FROM menu_items WHERE name IN ('Meal', 'Other meal')`,
  );
  itemId = items.find((item) => item.name === 'Meal')!.id;
  secondItemId = items.find((item) => item.name === 'Other meal')!.id;
  // Monthly allocation for the order's calendar month; the debit from order
  // placement is keyed to the same year/month.
  await query(
    `INSERT INTO budget_monthly_allocations (teacher_id, year, month, allocated_paisa, created_by)
     VALUES ($1, 2092, 1, 1500, $2)`,
    [teacherId, adminId],
  );
  await query(
    `INSERT INTO budget_ledger (teacher_id, year, month, entry_type, amount_paisa, reason, created_by)
     VALUES ($1, 2092, 1, 'allocation', 1500, 'test allocation', $2)`,
    [teacherId, adminId],
  );
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

describe('POST /api/orders', () => {
  it('calculates prices on the server, debits once, and replays idempotently', async () => {
    const body = {
      orderDate: '2092-01-02',
      foodLocationId: locationId,
      idempotencyKey: 'stable-order-key',
      totalPaisa: 1,
      items: [{ menuItemId: itemId, quantity: 1, notes: 'less spicy' }],
    };
    const created = await request(app).post('/api/orders').set(auth(teacherToken)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.total).toEqual({ amountPaisa: 1000, amountFormatted: '৳10.00' });
    expect(created.body.data.items[0]).toMatchObject({
      name: 'Meal',
      quantity: 1,
      unitPrice: { amountPaisa: 1000 },
    });

    const staffList = await request(app)
      .get(
        `/api/staff/orders?date=2092-01-02&locationId=${locationId}&status=CONFIRMED&page=1&pageSize=5`,
      )
      .set(auth(staffToken));
    expect(staffList.status).toBe(200);
    expect(staffList.body.meta).toEqual({ total: 1, page: 1, pageSize: 5 });
    expect(staffList.body.data[0]).toMatchObject({
      teacher: { id: teacherId },
      foodLocation: { id: locationId },
      items: [{ name: 'Meal', quantity: 1 }],
    });

    const grouped = await request(app)
      .get('/api/staff/orders/grouped?date=2092-01-02')
      .set(auth(adminToken));
    expect(grouped.status).toBe(200);
    expect(grouped.body.data).toMatchObject({
      orderCount: 1,
      locations: [
        {
          teacherCount: 1,
          total: { amountPaisa: 1000 },
          itemSummary: [{ name: 'Meal', quantity: 1 }],
        },
      ],
      dailyTotal: { amountPaisa: 1000 },
    });
    const daily = await request(app)
      .get('/api/staff/reports/daily?date=2092-01-02')
      .set(auth(staffToken));
    expect(daily.status).toBe(200);
    expect(daily.body.data).toMatchObject({
      locations: [{ location: { id: locationId }, orderCount: 1, total: { amountPaisa: 1000 } }],
      dailyTotal: { amountPaisa: 1000 },
    });
    const budgetReport = await request(app)
      .get('/api/staff/budgets/monthly?year=2092&month=1')
      .set(auth(staffToken));
    expect(budgetReport.status).toBe(200);
    const budgetRows = budgetReport.body.data as Array<{ teacher: { id: number } }>;
    const teacherRow = budgetRows.find((row) => row.teacher.id === teacherId);
    expect(teacherRow).toMatchObject({
      allocated: { amountPaisa: 1500 },
      spent: { amountPaisa: 1000 },
      remaining: { amountPaisa: 500 },
    });
    const teacherDenied = await request(app)
      .get('/api/staff/orders?date=2092-01-02')
      .set(auth(teacherToken));
    expect(teacherDenied.status).toBe(403);
    expect(
      (await request(app).get('/api/staff/reports/daily?date=2092-01-02').set(auth(teacherToken)))
        .status,
    ).toBe(403);

    await query('UPDATE menu_items SET price_paisa = 1200 WHERE id = $1', [itemId]);
    const replay = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        items: [{ menuItemId: itemId, quantity: 2 }],
      });
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.data.total.amountPaisa).toBe(1000);
    expect(await query('SELECT id FROM orders')).toHaveLength(1);
    expect(await query("SELECT id FROM budget_ledger WHERE entry_type = 'debit'")).toHaveLength(1);

    const insufficient = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        idempotencyKey: 'too-expensive',
        items: [{ menuItemId: itemId, quantity: 2 }],
      });
    expect(insufficient.status).toBe(422);
    expect(insufficient.body.error.code).toBe('BUDGET_INSUFFICIENT');
    expect(await query('SELECT id FROM orders')).toHaveLength(1);
    expect(await query("SELECT id FROM budget_ledger WHERE entry_type = 'debit'")).toHaveLength(1);

    const mixed = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        idempotencyKey: 'mixed',
        items: [
          { menuItemId: itemId, quantity: 1 },
          { menuItemId: secondItemId, quantity: 1 },
        ],
      });
    expect(mixed.status).toBe(422);
    expect(mixed.body.error.code).toBe('MIXED_LOCATIONS');

    await query('UPDATE menu_items SET is_available = false WHERE id = $1', [itemId]);
    const unavailable = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        orderDate: '2092-01-05',
        idempotencyKey: 'unavailable',
      });
    expect(unavailable.status).toBe(422);
    expect(unavailable.body.error.code).toBe('ITEM_UNAVAILABLE');
    await query('UPDATE menu_items SET is_available = true WHERE id = $1', [itemId]);

    const closed = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        orderDate: '2000-01-01',
        idempotencyKey: 'closed',
      });
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('ORDERING_CLOSED');

    const forbidden = await request(app).post('/api/orders').set(auth(adminToken)).send(body);
    expect(forbidden.status).toBe(403);

    const history = await request(app)
      .get('/api/orders/mine?status=CONFIRMED&page=1&pageSize=5')
      .set(auth(teacherToken));
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBe(1);
    expect(history.body.data[0].id).toBe(created.body.data.id);
    const detail = await request(app)
      .get(`/api/orders/mine/${created.body.data.id}`)
      .set(auth(teacherToken));
    expect(detail.status).toBe(200);
    const privateOrder = await request(app)
      .get(`/api/orders/mine/${created.body.data.id}`)
      .set(auth(otherTeacherToken));
    expect(privateOrder.status).toBe(404);

    const teacherCancel = await request(app)
      .post(`/api/orders/${created.body.data.id}/cancel`)
      .set(auth(teacherToken))
      .send({ reason: 'changed my mind' });
    expect(teacherCancel.status).toBe(200);
    expect(teacherCancel.body.data.status).toBe('CANCELLED');
    expect(await query("SELECT id FROM budget_ledger WHERE entry_type = 'refund'")).toHaveLength(1);
    const cancelledHistory = await request(app)
      .get('/api/orders/mine?page=1&pageSize=5')
      .set(auth(teacherToken));
    expect(cancelledHistory.status).toBe(200);
    expect(cancelledHistory.body.data[0]).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'teacher',
      cancelReason: 'changed my mind',
    });
    const repeatedCancel = await request(app)
      .post(`/api/orders/${created.body.data.id}/cancel`)
      .set(auth(teacherToken))
      .send({});
    expect(repeatedCancel.status).toBe(422);
    expect(repeatedCancel.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const staffOrder = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        orderDate: '2092-01-04',
        idempotencyKey: 'staff-cancel',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect(staffOrder.status).toBe(201);
    await query("UPDATE orders SET order_date = '2000-01-01' WHERE id = $1", [
      staffOrder.body.data.id,
    ]);
    const lateTeacherCancel = await request(app)
      .post(`/api/orders/${staffOrder.body.data.id}/cancel`)
      .set(auth(teacherToken))
      .send({});
    expect(lateTeacherCancel.status).toBe(422);
    expect(lateTeacherCancel.body.error.code).toBe('CUTOFF_PASSED');
    const staffCancel = await request(app)
      .patch(`/api/staff/orders/${staffOrder.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'CANCELLED', note: 'vendor requested cancellation' });
    expect(staffCancel.status).toBe(200);
    expect(
      await query("SELECT id FROM audit_logs WHERE action = 'order.cancelled_by_staff'"),
    ).toHaveLength(1);

    const trackedOrder = await request(app)
      .post('/api/orders')
      .set(auth(teacherToken))
      .send({
        ...body,
        orderDate: '2092-01-06',
        idempotencyKey: 'status-transition',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect(trackedOrder.status).toBe(201);
    const managed = await request(app)
      .patch(`/api/staff/orders/${trackedOrder.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED', note: 'picked up' });
    expect(managed.status).toBe(200);
    expect(managed.body.data).toMatchObject({ oldStatus: 'CONFIRMED', status: 'COLLECTED' });
    const delivered = await request(app)
      .patch(`/api/staff/orders/${trackedOrder.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'DELIVERED' });
    expect(delivered.status).toBe(200);
    const backward = await request(app)
      .patch(`/api/staff/orders/${trackedOrder.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED' });
    expect(backward.status).toBe(422);
    expect(backward.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const itemIdForStatus = trackedOrder.body.data.items[0].id as number;
    const collectedItem = await request(app)
      .patch(`/api/staff/order-items/${itemIdForStatus}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED' });
    expect(collectedItem.status).toBe(200);
    const deliveredItem = await request(app)
      .patch(`/api/staff/order-items/${itemIdForStatus}/status`)
      .set(auth(staffToken))
      .send({ status: 'DELIVERED' });
    expect(deliveredItem.status).toBe(200);
    const teacherStatusDenied = await request(app)
      .patch(`/api/staff/orders/${trackedOrder.body.data.id}/status`)
      .set(auth(teacherToken))
      .send({ status: 'COLLECTED' });
    expect(teacherStatusDenied.status).toBe(403);
    expect(
      await query("SELECT id FROM audit_logs WHERE action = 'order.status.changed'"),
    ).toHaveLength(2);
  });

  it('holds the estimate at placement and reconciles the actual cost at delivery', async () => {
    // Fresh teacher with a 1000 taka allocation for 2092-01.
    const newTeacherId = await seedUser('reconcile-teacher@juniv.edu', 'TEACHER');
    await query(
      `INSERT INTO budget_monthly_allocations (teacher_id, year, month, allocated_paisa, created_by)
       VALUES ($1, 2092, 1, 100000, (SELECT id FROM users WHERE email = 'order-admin@juniv.edu'))`,
      [newTeacherId],
    );
    await query(
      `INSERT INTO budget_ledger (teacher_id, year, month, entry_type, amount_paisa, reason, created_by)
       VALUES ($1, 2092, 1, 'allocation', 100000, 'test allocation',
               (SELECT id FROM users WHERE email = 'order-admin@juniv.edu'))`,
      [newTeacherId],
    );
    const reconcilerToken = await login('reconcile-teacher@juniv.edu');

    // The teacher declares a fallback dish with the order. "Meal" costs 1200
    // paisa after the first test's price update.
    const created = await request(app)
      .post('/api/orders')
      .set(auth(reconcilerToken))
      .send({
        orderDate: '2092-01-10',
        foodLocationId: locationId,
        idempotencyKey: 'reconcile-cheaper',
        items: [{ menuItemId: itemId, quantity: 1 }],
        alternativeItemName: 'Veg Tehari',
        alternativeUnitPricePaisa: 800,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.total.amountPaisa).toBe(1200);

    // The estimated total is debited immediately at placement (decision B).
    const placementDebits = await query<{ id: number }>(
      `SELECT id FROM budget_ledger
        WHERE teacher_id = $1 AND entry_type = 'debit' AND order_id = $2`,
      [newTeacherId, created.body.data.id],
    );
    expect(placementDebits).toHaveLength(1);

    // Collect, then deliver at a cheaper actual cost: the difference is refunded.
    await request(app)
      .patch(`/api/staff/orders/${created.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED', note: 'picked up' });
    const delivered = await request(app)
      .patch(`/api/staff/orders/${created.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'DELIVERED', actualCostPaisa: 700, alternativeItemName: 'Egg Khichuri' });
    expect(delivered.status).toBe(200);

    const entries = await query<{ entry_type: string; amount_paisa: number }>(
      `SELECT entry_type, amount_paisa FROM budget_ledger
        WHERE teacher_id = $1 AND order_id = $2 ORDER BY id`,
      [newTeacherId, created.body.data.id],
    );
    expect(entries.map((entry) => [entry.entry_type, Number(entry.amount_paisa)])).toEqual([
      ['debit', -1200],
      ['refund', 500],
    ]);

    const orderRow = (
      await query<{
        total_paisa: number;
        actual_cost_paisa: number;
        alternative_item_name: string;
      }>(`SELECT total_paisa, actual_cost_paisa, alternative_item_name FROM orders WHERE id = $1`, [
        created.body.data.id,
      ])
    )[0]!;
    expect(Number(orderRow.total_paisa)).toBe(700);
    expect(Number(orderRow.actual_cost_paisa)).toBe(700);
    expect(orderRow.alternative_item_name).toBe('Egg Khichuri');

    // Delivering without an actual cost keeps the estimate and books nothing new.
    const second = await request(app)
      .post('/api/orders')
      .set(auth(reconcilerToken))
      .send({
        orderDate: '2092-01-11',
        foodLocationId: locationId,
        idempotencyKey: 'reconcile-exact',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect(second.status).toBe(201);
    await request(app)
      .patch(`/api/staff/orders/${second.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED', note: 'picked up' });
    const deliveredExact = await request(app)
      .patch(`/api/staff/orders/${second.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'DELIVERED' });
    expect(deliveredExact.status).toBe(200);
    expect(
      await query(
        `SELECT id FROM budget_ledger WHERE teacher_id = $1 AND order_id = $2
          AND entry_type IN ('refund', 'adjustment')`,
        [newTeacherId, second.body.data.id],
      ),
    ).toHaveLength(0);
    const secondRow = (
      await query<{ total_paisa: number; actual_cost_paisa: number | null }>(
        `SELECT total_paisa, actual_cost_paisa FROM orders WHERE id = $1`,
        [second.body.data.id],
      )
    )[0]!;
    expect(Number(secondRow.total_paisa)).toBe(1200);
    expect(Number(secondRow.actual_cost_paisa)).toBe(1200);

    // A costlier delivery debits the difference instead.
    const third = await request(app)
      .post('/api/orders')
      .set(auth(reconcilerToken))
      .send({
        orderDate: '2092-01-12',
        foodLocationId: locationId,
        idempotencyKey: 'reconcile-costlier',
        items: [{ menuItemId: itemId, quantity: 1 }],
      });
    expect(third.status).toBe(201);
    await request(app)
      .patch(`/api/staff/orders/${third.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'COLLECTED', note: 'picked up' });
    const deliveredCostlier = await request(app)
      .patch(`/api/staff/orders/${third.body.data.id}/status`)
      .set(auth(staffToken))
      .send({ status: 'DELIVERED', actualCostPaisa: 2000 });
    expect(deliveredCostlier.status).toBe(200);
    const costlierEntries = await query<{ entry_type: string; amount_paisa: number }>(
      `SELECT entry_type, amount_paisa FROM budget_ledger
        WHERE teacher_id = $1 AND order_id = $2 AND entry_type = 'debit' ORDER BY id`,
      [newTeacherId, third.body.data.id],
    );
    expect(costlierEntries.map((entry) => Number(entry.amount_paisa))).toEqual([-1200, -800]);
    const thirdRow = (
      await query<{ total_paisa: number }>(`SELECT total_paisa FROM orders WHERE id = $1`, [
        third.body.data.id,
      ])
    )[0]!;
    expect(Number(thirdRow.total_paisa)).toBe(2000);
  });
});
