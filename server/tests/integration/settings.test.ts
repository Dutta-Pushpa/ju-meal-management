import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { closePool, getPool, query, truncateAll } from '../helpers/database.js';
import { checkOrderingRules } from '../../src/models/order.model.js';

const password = 'SettingsPass123!';
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
const logger = {
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
let staffToken: string;
let teacherToken: string;

async function seedUser(
  email: string,
  role: 'ADMIN' | 'STAFF' | 'TEACHER',
  permissions: string[] = [],
) {
  const { hashPassword } = await import('../../src/utils/password.js');
  await query(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [email, email, await hashPassword(password, 10), role, JSON.stringify(permissions)],
  );
}

async function login(email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger, db });
  await seedUser('settings-admin@juniv.edu', 'ADMIN');
  await seedUser('settings-staff@juniv.edu', 'STAFF', ['settings:manage', 'users:manage']);
  await seedUser('settings-teacher@juniv.edu', 'TEACHER');
  adminToken = await login('settings-admin@juniv.edu');
  staffToken = await login('settings-staff@juniv.edu');
  teacherToken = await login('settings-teacher@juniv.edu');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

describe('/api/staff/settings', () => {
  it('requires settings permission to read and update', async () => {
    expect((await request(app).get('/api/staff/settings').set(auth(teacherToken))).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .patch('/api/staff/settings/order_placement_deadline')
          .set(auth(teacherToken))
          .send({ value: "10:30" })
      ).status,
    ).toBe(403);
  });

  it('reads settings and persists validated changes with an audit record', async () => {
    const list = await request(app).get('/api/staff/settings').set(auth(adminToken));
    expect(list.status).toBe(200);
    const settings = list.body.data as Array<{ key: string; value: string }>;
    const cutoffTime = settings.find((entry) => entry.key === 'order_placement_deadline');
    expect(cutoffTime).toBeDefined();
    expect(cutoffTime!.value).toBe("12:30");

    const updated = await request(app)
      .patch('/api/staff/settings/order_placement_deadline')
      .set(auth(staffToken))
      .send({ value: "10:30" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.value).toBe("10:30");
    expect(
      (
        await query<{ value: string }>(
          `SELECT value #>> '{}' AS value FROM app_settings WHERE key = 'order_placement_deadline'`,
        )
      )[0]!.value,
    ).toBe("10:30");
    expect(
      await query(
        `SELECT id FROM audit_logs WHERE action = 'setting.updated' AND metadata->>'key' = 'order_placement_deadline'`,
      ),
    ).toHaveLength(1);

    await request(app)
      .patch('/api/staff/settings/order_placement_deadline')
      .set(auth(adminToken))
      .send({ value: '00:00' });
    const today = (
      await query<{ date: string }>(`SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date::text AS date`)
    )[0]!.date;
    expect(await checkOrderingRules(db, today)).toMatchObject({ closed: true, disabled: false });
  });

  it('rejects invalid values and unknown settings', async () => {
    expect(
      (
        await request(app)
          .patch('/api/staff/settings/order_placement_deadline')
          .set(auth(adminToken))
          .send({ value: "25:61" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch('/api/staff/settings/not_a_setting')
          .set(auth(adminToken))
          .send({ value: true })
      ).status,
    ).toBe(400);
  });

  it('limits staff user management and lets admins deactivate teachers with session revocation', async () => {
    const teacher = (
      await query<{ id: number }>(`SELECT id FROM users WHERE email = 'settings-teacher@juniv.edu'`)
    )[0]!;
    const denied = await request(app)
      .patch(`/api/staff/users/${teacher.id}`)
      .set(auth(staffToken))
      .send({ role: 'ADMIN' });
    expect(denied.status).toBe(403);

    const updated = await request(app)
      .patch(`/api/staff/users/${teacher.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isActive).toBe(false);
    expect(
      await query(`SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [
        teacher.id,
      ]),
    ).toHaveLength(0);
  });

  it('prevents deactivating the last active administrator', async () => {
    const admin = (
      await query<{ id: number }>(`SELECT id FROM users WHERE email = 'settings-admin@juniv.edu'`)
    )[0]!;
    const response = await request(app)
      .patch(`/api/staff/users/${admin.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(response.status).toBe(422);
  });
});
