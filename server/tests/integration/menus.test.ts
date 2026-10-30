import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';

const PASSWORD = 'MenuPass123!';
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
let managerToken: string;
let teacherToken: string;
let noPermissionToken: string;
let teacherId: number;
let locationId: number;
let suffix = 0;

function unique(prefix: string): string {
  suffix += 1;
  return `${prefix}-${suffix}`;
}

async function seedUser(
  email: string,
  role: 'ADMIN' | 'STAFF' | 'TEACHER',
  permissions: string[] = [],
) {
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });
  await seedUser('admin@juniv.edu', 'ADMIN');
  await seedUser('manager@juniv.edu', 'STAFF', ['menu_items:manage']);
  await seedUser('restricted@juniv.edu', 'STAFF');
  teacherId = await seedUser('teacher@juniv.edu', 'TEACHER');
  adminToken = await login('admin@juniv.edu');
  managerToken = await login('manager@juniv.edu');
  noPermissionToken = await login('restricted@juniv.edu');
  teacherToken = await login('teacher@juniv.edu');
  const locations = await query<{ id: number }>(
    `INSERT INTO food_locations (name) VALUES ($1) RETURNING id`,
    [unique('Vendor')],
  );
  locationId = locations[0]!.id;
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

describe('GET /api/locations/:id/menu', () => {
  it('requires authentication', async () => {
    const response = await request(app).get(`/api/locations/${locationId}/menu`);
    expect(response.status).toBe(401);
  });

  it('returns active items with availability and paisa-formatted prices', async () => {
    await query(
      `INSERT INTO menu_items (food_location_id, name, category, price_paisa)
       VALUES ($1, 'Soup', 'lunch', 1250), ($1, 'Hidden', 'lunch', 500), ($1, 'Inactive', 'lunch', 600)`,
      [locationId],
    );
    await query(`UPDATE menu_items SET is_available = false WHERE name = 'Hidden'`);
    await query(`UPDATE menu_items SET is_active = false WHERE name = 'Inactive'`);

    const response = await request(app)
      .get(`/api/locations/${locationId}/menu`)
      .set(auth(teacherToken));
    expect(response.status).toBe(200);
    expect(response.body.data.location).toEqual({ id: locationId, name: expect.any(String) });
    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        name: 'Hidden',
        price: { amountPaisa: 500, amountFormatted: '৳5.00' },
        isAvailable: false,
        availabilityLabel: 'Sold out',
        orderable: false,
      }),
      expect.objectContaining({
        name: 'Soup',
        price: { amountPaisa: 1250, amountFormatted: '৳12.50' },
        isAvailable: true,
        availabilityLabel: 'Available',
        orderable: true,
      }),
    ]);
  });

  it('returns 404 for an inactive location', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO food_locations (name, is_active) VALUES ($1, false) RETURNING id`,
      [unique('Inactive vendor')],
    );
    const response = await request(app)
      .get(`/api/locations/${rows[0]!.id}/menu`)
      .set(auth(teacherToken));
    expect(response.status).toBe(404);
  });
});

describe('menu item administration', () => {
  it('allows an admin and any staff member (role-only access), and rejects other callers', async () => {
    const body = { foodLocationId: locationId, name: unique('Item'), pricePaisa: 9000 };
    const denied = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(teacherToken))
      .send(body);
    expect(denied.status).toBe(403);

    // Role-only access: every staff member may manage menu items, regardless
    // of any legacy stored permission list.
    const created = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(noPermissionToken))
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      foodLocationId: locationId,
      name: body.name,
      price: { amountPaisa: 9000 },
      isActive: true,
    });
  });

  it('validates price and active location on creation', async () => {
    const invalidPrice = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(adminToken))
      .send({
        foodLocationId: locationId,
        name: unique('Bad price'),
        pricePaisa: 0,
      });
    expect(invalidPrice.status).toBe(400);

    const inactiveLocation = await query<{ id: number }>(
      `INSERT INTO food_locations (name, is_active) VALUES ($1, false) RETURNING id`,
      [unique('Inactive vendor')],
    );
    const invalidLocation = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(adminToken))
      .send({
        foodLocationId: inactiveLocation[0]!.id,
        name: unique('Bad location'),
        pricePaisa: 1000,
      });
    expect(invalidLocation.status).toBe(404);
  });

  it('updates fields without erasing omitted values and retains order snapshots', async () => {
    const created = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(adminToken))
      .send({
        foodLocationId: locationId,
        name: unique('Snapshot meal'),
        category: 'lunch',
        pricePaisa: 1000,
      });
    const itemId = created.body.data.id as number;
    const order = await query<{ id: number }>(
      `INSERT INTO orders (teacher_id, food_location_id, order_date, total_paisa)
       VALUES ($1, $2, current_date, 1000) RETURNING id`,
      [teacherId, locationId],
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot,
       unit_price_paisa_snapshot, quantity, line_total_paisa)
       VALUES ($1, $2, 'Snapshot meal', 1000, 1, 1000)`,
      [order[0]!.id, itemId],
    );

    const updated = await request(app)
      .patch(`/api/staff/menu-items/${itemId}`)
      .set(auth(managerToken))
      .send({ name: 'Renamed meal', pricePaisa: 1500 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: 'Renamed meal', category: 'lunch' });
    const snapshot = await query<{ item_name_snapshot: string; unit_price_paisa_snapshot: number }>(
      `SELECT item_name_snapshot, unit_price_paisa_snapshot FROM order_items WHERE order_id = $1`,
      [order[0]!.id],
    );
    expect(snapshot[0]).toEqual({
      item_name_snapshot: 'Snapshot meal',
      unit_price_paisa_snapshot: 1000,
    });
  });

  it('soft-deactivates idempotently without deleting the item', async () => {
    const created = await request(app)
      .post('/api/staff/menu-items')
      .set(auth(adminToken))
      .send({
        foodLocationId: locationId,
        name: unique('Deactivate me'),
        pricePaisa: 7000,
      });
    const id = created.body.data.id as number;
    const first = await request(app).delete(`/api/staff/menu-items/${id}`).set(auth(adminToken));
    const second = await request(app).delete(`/api/staff/menu-items/${id}`).set(auth(adminToken));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.isActive).toBe(false);
    expect(await query('SELECT id FROM menu_items WHERE id = $1', [id])).toHaveLength(1);
  });
});

describe('GET /api/staff/menu-items', () => {
  it('returns the full admin catalogue only to menu managers', async () => {
    const active = unique('Managed active item');
    const inactive = unique('Managed inactive item');
    await query(
      `INSERT INTO menu_items (food_location_id, name, price_paisa, is_available, is_active)
       VALUES ($1, $2, 2500, true, true), ($1, $3, 3500, false, false)`,
      [locationId, active, inactive],
    );

    const denied = await request(app).get('/api/staff/menu-items').set(auth(teacherToken));
    expect(denied.status).toBe(403);

    const response = await request(app).get('/api/staff/menu-items').set(auth(managerToken));
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(response.body.data.length);
    expect(response.body.data.map((item: { name: string }) => item.name)).toContain(inactive);
    expect(response.body.data.find((item: { name: string }) => item.name === active)).toMatchObject(
      {
        location: { id: locationId },
        price: { amountPaisa: 2500 },
      },
    );
  });
});

describe('GET /api/staff/users and /api/staff/teachers', () => {
  it('returns safe directory data to admins and restricts teacher listings by permission', async () => {
    const usersResponse = await request(app).get('/api/staff/users').set(auth(adminToken));
    expect(usersResponse.status).toBe(200);
    expect(
      usersResponse.body.data.some((user: { email: string }) => user.email === 'teacher@juniv.edu'),
    ).toBe(true);
    expect(JSON.stringify(usersResponse.body)).not.toContain('password_hash');

    const denied = await request(app).get('/api/staff/users').set(auth(teacherToken));
    expect(denied.status).toBe(403);
    const teachers = await request(app).get('/api/staff/teachers').set(auth(adminToken));
    expect(teachers.status).toBe(200);
    expect(
      teachers.body.data.some(
        (teacher: { email: string }) => teacher.email === 'teacher@juniv.edu',
      ),
    ).toBe(true);
  });
});
