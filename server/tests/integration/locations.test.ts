import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, queryOne, truncateAll } from '../helpers/database.js';

/**
 * Food-location CRUD, end to end over HTTP.
 *
 * These cases pin the rules from docs/api.md and docs/policies.md: reading is
 * open to any signed-in user, writing needs ADMIN or the `locations:manage`
 * permission, deletion is a soft deactivation, and a location with live orders in
 * the current period cannot be deactivated.
 */

const TEST_BCRYPT_COST = 10;
const TZ = 'Asia/Dhaka';
const PASSWORD = 'LocationPass123!';

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
  BCRYPT_COST: TEST_BCRYPT_COST,
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
let collectorToken: string;
let teacherToken: string;

let teacherId: number;
let nameCounter = 0;

function uniqueName(prefix: string): string {
  nameCounter += 1;
  return `${prefix} ${nameCounter}`;
}

async function seedUser(input: {
  email: string;
  role: 'TEACHER' | 'STAFF' | 'ADMIN';
  permissions?: string[];
}): Promise<number> {
  const { hashPassword } = await import('../../src/utils/password.js');
  const rows = await query<{ id: number }>(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [
      input.email.split('@')[0],
      input.email,
      await hashPassword(PASSWORD, TEST_BCRYPT_COST),
      input.role,
      JSON.stringify(input.permissions ?? []),
    ],
  );

  return rows[0]!.id;
}

async function loginToken(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/** Insert a location directly, for fixtures that are not the subject of the test. */
async function seedLocation(input: {
  name: string;
  nameBn?: string | null;
  description?: string | null;
  isActive?: boolean;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO food_locations (name, name_bn, description, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.name, input.nameBn ?? null, input.description ?? null, input.isActive ?? true],
  );

  return rows[0]!.id;
}

/** A budget period that contains today, in the application timezone. */
async function seedPastPeriod(): Promise<void> {
  await query(
    `INSERT INTO budget_periods (name, starts_on, ends_on)
     VALUES ($1, (now() AT TIME ZONE $2)::date - 120, (now() AT TIME ZONE $2)::date - 100)`,
    [uniqueName('past-period'), TZ],
  );
}

async function seedOrder(
  locationId: number,
  status: 'CONFIRMED' | 'COLLECTED' | 'DELIVERED' | 'CANCELLED' = 'CONFIRMED',
): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa, cancelled_at)
     VALUES ($1, $2, (now() AT TIME ZONE $3)::date, $4, 10000,
             CASE WHEN $4 = 'CANCELLED' THEN now() ELSE NULL END)
     RETURNING id`,
    [teacherId, locationId, TZ, status],
  );

  return rows[0]!.id;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });

  await seedUser({ email: 'admin@juniv.edu', role: 'ADMIN' });
  await seedUser({
    email: 'manager@juniv.edu',
    role: 'STAFF',
    permissions: ['locations:manage'],
  });
  await seedUser({
    email: 'collector@juniv.edu',
    role: 'STAFF',
    permissions: ['orders:manage_status'],
  });
  teacherId = await seedUser({ email: 'teacher@juniv.edu', role: 'TEACHER' });

  adminToken = await loginToken('admin@juniv.edu');
  managerToken = await loginToken('manager@juniv.edu');
  collectorToken = await loginToken('collector@juniv.edu');
  teacherToken = await loginToken('teacher@juniv.edu');

  // One current period, shared by every test. A second overlapping period would
  // violate the no-overlap constraint, so it is created exactly once here.
  await query(
    `INSERT INTO budget_periods (name, starts_on, ends_on)
     VALUES ($1, (now() AT TIME ZONE $2)::date - 1, (now() AT TIME ZONE $2)::date + 1)`,
    [uniqueName('current-period'), TZ],
  );
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

// =====================================================================
describe('GET /api/locations', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns active locations only, with a total', async () => {
    const active = uniqueName('Visible');
    const hidden = uniqueName('Hidden');
    const activeId = await seedLocation({ name: active });
    await seedLocation({ name: hidden, isActive: false });
    await query(
      `INSERT INTO menu_items (food_location_id, name, price_paisa, is_available)
       VALUES ($1, 'Available test item', 1000, true), ($1, 'Sold out test item', 1000, false)`,
      [activeId],
    );

    const res = await request(app).get('/api/locations').set(authHeader(teacherToken));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(res.body.data.length);

    const names = (res.body.data as Array<{ name: string; isActive: boolean }>).map((l) => l.name);
    expect(names).toContain(active);
    expect(names).not.toContain(hidden);
    expect((res.body.data as Array<{ isActive: boolean }>).every((l) => l.isActive === true)).toBe(
      true,
    );
    expect(
      (res.body.data as Array<{ id: number; availableMenuItemCount: number }>).find(
        (location) => location.id === activeId,
      )?.availableMenuItemCount,
    ).toBe(1);
  });

  it('is open to a teacher, not only to staff', async () => {
    const res = await request(app).get('/api/locations').set(authHeader(teacherToken));
    expect(res.status).toBe(200);
  });
});

// =====================================================================
describe('GET /api/locations/:id', () => {
  it('returns a single active location', async () => {
    const id = await seedLocation({ name: uniqueName('Single'), description: 'A vendor' });

    const res = await request(app).get(`/api/locations/${id}`).set(authHeader(teacherToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, description: 'A vendor', isActive: true });
  });

  it('reports an inactive location as 404', async () => {
    const id = await seedLocation({ name: uniqueName('Gone'), isActive: false });

    const res = await request(app).get(`/api/locations/${id}`).set(authHeader(teacherToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('reports a missing location as 404', async () => {
    const res = await request(app).get('/api/locations/999999').set(authHeader(teacherToken));
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id', async () => {
    const res = await request(app).get('/api/locations/abc').set(authHeader(teacherToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// =====================================================================
describe('POST /api/locations', () => {
  const valid = () => ({
    name: uniqueName('New Vendor'),
    nameBn: 'বটতলা',
    description: 'Bakery and fast food',
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/locations').send(valid());
    expect(res.status).toBe(401);
  });

  it('refuses a teacher', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(teacherToken))
      .send(valid());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows any staff member (role-only access)', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(collectorToken))
      .send(valid());
    expect(res.status).toBe(201);
  });

  it('allows a staff account holding locations:manage', async () => {
    const body = valid();
    const res = await request(app).post('/api/locations').set(authHeader(managerToken)).send(body);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ ...body, isActive: true });
  });

  it('allows an admin', async () => {
    const res = await request(app).post('/api/locations').set(authHeader(adminToken)).send(valid());
    expect(res.status).toBe(201);
  });

  it('defaults the optional fields to null', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name: uniqueName('Bare') });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ nameBn: null, description: null });
  });

  it('trims the name', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name: '  Trimmed Vendor  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Trimmed Vendor');
  });

  it('rejects a taken name, case-insensitively, with 409', async () => {
    const name = uniqueName('Taken');
    await seedLocation({ name });

    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name: name.toUpperCase() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOCATION_ALREADY_EXISTS');
  });

  it('rejects a missing name', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ description: 'no name here' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an over-long name', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name: 'x'.repeat(201) });

    expect(res.status).toBe(400);
  });

  it('rejects a non-English name and suggests nameBn', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name: 'বোত্তলা', nameBn: 'বোত্তলা' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/nameBn/i);
  });

  it('keeps English names with digits and punctuation valid', async () => {
    const name = uniqueName('Cafeteria No. 2 (Old Block)');
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name, nameBn: 'ক্যাফেটেরিয়া' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(name);
  });

  it('also enforces English names on PATCH', async () => {
    const id = await seedLocation({ name: uniqueName('Renamable') });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ name: 'গেরুয়া' });

    expect(res.status).toBe(400);
  });

  it('records an audit entry', async () => {
    const name = uniqueName('Audited');
    const res = await request(app)
      .post('/api/locations')
      .set(authHeader(adminToken))
      .send({ name });

    expect(res.status).toBe(201);

    const audit = await queryOne<{ action: string; metadata: { name: string } }>(
      `SELECT action, metadata FROM audit_logs
        WHERE action = 'location.created' AND metadata->>'name' = $1`,
      [name],
    );

    expect(audit?.action).toBe('location.created');
  });
});

// =====================================================================
describe('PATCH /api/locations/:id', () => {
  it('refuses a teacher', async () => {
    const id = await seedLocation({ name: uniqueName('Patch Refused') });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(teacherToken))
      .send({ description: 'nope' });

    expect(res.status).toBe(403);
  });

  it('updates only the supplied fields', async () => {
    const id = await seedLocation({
      name: uniqueName('Partial'),
      nameBn: 'আগের',
      description: 'original',
    });

    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(managerToken))
      .send({ description: 'updated' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      nameBn: 'আগের',
      description: 'updated',
    });
  });

  it('clears a nullable field with an explicit null', async () => {
    const id = await seedLocation({ name: uniqueName('Clearable'), nameBn: 'হবে না' });

    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ nameBn: null });

    expect(res.status).toBe(200);
    expect(res.body.data.nameBn).toBeNull();
  });

  it('rejects renaming onto an existing name with 409', async () => {
    const taken = uniqueName('Occupied');
    await seedLocation({ name: taken });
    const id = await seedLocation({ name: uniqueName('Renamer') });

    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ name: taken });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOCATION_ALREADY_EXISTS');
  });

  it('reports a missing location as 404', async () => {
    const res = await request(app)
      .patch('/api/locations/999999')
      .set(authHeader(adminToken))
      .send({ description: 'x' });

    expect(res.status).toBe(404);
  });

  it('rejects an empty patch', async () => {
    const id = await seedLocation({ name: uniqueName('Empty Patch') });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-boolean isActive', async () => {
    const id = await seedLocation({ name: uniqueName('Bad Flag') });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ isActive: 'yes' });

    expect(res.status).toBe(400);
  });

  it('deactivates a location with no current orders', async () => {
    const id = await seedLocation({ name: uniqueName('No Orders') });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('refuses to deactivate a location with orders in the current period', async () => {
    const id = await seedLocation({ name: uniqueName('Busy') });
    await seedOrder(id, 'CONFIRMED');

    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOCATION_HAS_ACTIVE_ORDERS');
  });

  it('allows deactivation when the only current order is cancelled', async () => {
    const id = await seedLocation({ name: uniqueName('Cancelled Order') });
    await seedOrder(id, 'CANCELLED');

    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('can reactivate a location', async () => {
    const id = await seedLocation({ name: uniqueName('Reactivate'), isActive: false });
    const res = await request(app)
      .patch(`/api/locations/${id}`)
      .set(authHeader(adminToken))
      .send({ isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
  });
});

// =====================================================================
describe('DELETE /api/locations/:id', () => {
  it('requires authentication', async () => {
    const id = await seedLocation({ name: uniqueName('Delete Anon') });
    const res = await request(app).delete(`/api/locations/${id}`);
    expect(res.status).toBe(401);
  });

  it('refuses a teacher', async () => {
    const id = await seedLocation({ name: uniqueName('Delete Teacher') });
    const res = await request(app).delete(`/api/locations/${id}`).set(authHeader(teacherToken));
    expect(res.status).toBe(403);
  });

  it('soft-deactivates and keeps the row', async () => {
    const id = await seedLocation({ name: uniqueName('Soft Delete') });

    const res = await request(app).delete(`/api/locations/${id}`).set(authHeader(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const row = await queryOne<{ is_active: boolean }>(
      `SELECT is_active FROM food_locations WHERE id = $1`,
      [id],
    );
    // The row still exists; only the flag changed. Historical orders reference it.
    expect(row).toBeDefined();
    expect(row?.is_active).toBe(false);
  });

  it('refuses when the location has orders in the current period', async () => {
    const id = await seedLocation({ name: uniqueName('Delete Busy') });
    await seedOrder(id, 'CONFIRMED');

    const res = await request(app).delete(`/api/locations/${id}`).set(authHeader(adminToken));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOCATION_HAS_ACTIVE_ORDERS');
  });

  it('allows deletion when the only order is in a past period', async () => {
    const id = await seedLocation({ name: uniqueName('Old Orders') });
    await seedPastPeriod();
    // Send the order date from the source rather than "today".
    await query(
      `INSERT INTO orders (teacher_id, food_location_id, order_date, status, total_paisa)
       VALUES ($1, $2, (now() AT TIME ZONE $3)::date - 110, 'CONFIRMED', 10000)`,
      [teacherId, id, TZ],
    );

    const res = await request(app).delete(`/api/locations/${id}`).set(authHeader(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('is idempotent for an already-inactive location', async () => {
    const id = await seedLocation({ name: uniqueName('Already Off'), isActive: false });

    const res = await request(app).delete(`/api/locations/${id}`).set(authHeader(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('reports a missing location as 404', async () => {
    const res = await request(app).delete('/api/locations/999999').set(authHeader(adminToken));
    expect(res.status).toBe(404);
  });

  it('records a deactivation audit entry', async () => {
    const name = uniqueName('Delete Audited');
    const id = await seedLocation({ name });

    await request(app).delete(`/api/locations/${id}`).set(authHeader(adminToken));

    const audit = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE action = 'location.deactivated' AND metadata->>'name' = $1`,
      [name],
    );

    expect(audit?.action).toBe('location.deactivated');
  });
});

describe('GET /api/locations/manage/all', () => {
  it('requires location-management access and includes deactivated locations for managers', async () => {
    const activeName = uniqueName('Managed active');
    const inactiveName = uniqueName('Managed inactive');
    await seedLocation({ name: activeName });
    await seedLocation({ name: inactiveName, isActive: false });

    const denied = await request(app)
      .get('/api/locations/manage/all')
      .set(authHeader(teacherToken));
    expect(denied.status).toBe(403);

    const response = await request(app)
      .get('/api/locations/manage/all')
      .set(authHeader(managerToken));
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(response.body.data.length);
    expect(response.body.data.map((location: { name: string }) => location.name)).toContain(
      inactiveName,
    );
  });
});
