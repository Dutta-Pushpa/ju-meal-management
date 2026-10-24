import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Database } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';
import { createApp } from '../../src/app.js';
import { getPool, query, truncateAll } from '../helpers/database.js';

/**
 * Authentication and authorisation, end to end over HTTP.
 *
 * Every case here corresponds to a rule in docs/policies.md or a security
 * requirement: a teacher must not reach another account, a staff account must
 * not reach what it was not granted, and a signed-out token must stop working
 * immediately rather than at its expiry.
 */

// Cost 10 keeps the suite fast. Production uses 12.
const TEST_BCRYPT_COST = 10;

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
  APP_TIMEZONE: 'Asia/Dhaka',
  ORDER_CUTOFF_TIME: '12:00',
  BUDGET_ROLLOVER: false,
  DEFAULT_WEEKLY_BUDGET_PAISA: 70_000,
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

const TEACHER_PASSWORD = 'TeacherPass123!';
const STAFF_PASSWORD = 'StaffPass123!';

let app: Express;
let db: Database;

/** Create an account directly, bypassing the endpoint, for fixtures. */
async function seedUser(input: {
  email: string;
  role: 'TEACHER' | 'STAFF' | 'ADMIN';
  permissions?: string[];
  password?: string;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ($1, $2, 'unused-in-these-fixtures', $3, $4::jsonb)
     RETURNING id`,
    [input.email.split('@')[0], input.email, input.role, JSON.stringify(input.permissions ?? [])],
  );

  return rows[0]!.id;
}

/** Register through the API and return the created user. */
async function registerViaApi(body: Record<string, unknown>): Promise<request.Response> {
  return request(app).post('/api/auth/register').send(body);
}

async function loginViaApi(email: string, password: string): Promise<request.Response> {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(async () => {
  db = getPool();
  await truncateAll();
  app = createApp({ config, logger: silentLogger, db });

  // Account with a real password hash, for sign-in tests.
  const { hashPassword } = await import('../../src/utils/password.js');
  await query(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ('Rumana Haque', 'teacher@juniv.edu', $1, 'TEACHER', '[]'::jsonb)`,
    [await hashPassword(TEACHER_PASSWORD, TEST_BCRYPT_COST)],
  );
  await query(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ('Demo Staff', 'staff@juniv.edu', $1, 'STAFF', '["orders:manage_status"]'::jsonb)`,
    [await hashPassword(STAFF_PASSWORD, TEST_BCRYPT_COST)],
  );
});

afterAll(async () => {
  await truncateAll();
});

// =====================================================================
describe('POST /api/auth/register', () => {
  it('creates a teacher and returns no password material', async () => {
    const res = await registerViaApi({
      fullName: 'New Teacher',
      email: 'newteacher@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fullName: 'New Teacher',
      email: 'newteacher@juniv.edu',
      role: 'TEACHER',
      permissions: [],
      isActive: true,
    });

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain(TEACHER_PASSWORD);
    expect(serialised).not.toContain('$2b$');
  });

  it('stores the password as a bcrypt hash, never in plaintext', async () => {
    await registerViaApi({
      fullName: 'Hash Check',
      email: 'hashcheck@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    const rows = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = 'hashcheck@juniv.edu'`,
    );

    expect(rows[0]?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0]?.password_hash).not.toContain(TEACHER_PASSWORD);
  });

  it('lowercases the email so uniqueness is not case dependent', async () => {
    const res = await registerViaApi({
      fullName: 'Mixed Case',
      email: 'MixedCase@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('mixedcase@juniv.edu');
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await registerViaApi({
      fullName: 'Duplicate',
      email: 'newteacher@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects a duplicate email that differs only in case', async () => {
    const res = await registerViaApi({
      fullName: 'Duplicate',
      email: 'NEWTEACHER@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(409);
  });

  it('rejects a short password', async () => {
    const res = await registerViaApi({
      fullName: 'Weak',
      email: 'weak@juniv.edu',
      password: 'short1!',
      role: 'TEACHER',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a password over 72 UTF-8 bytes', async () => {
    const res = await registerViaApi({
      fullName: 'Too Long',
      email: 'toolong@juniv.edu',
      password: 'আ'.repeat(30),
      role: 'TEACHER',
    });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const res = await registerViaApi({
      fullName: 'Bad Email',
      email: 'not-an-email',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]?.field).toBe('email');
  });

  it('rejects an unknown role', async () => {
    const res = await registerViaApi({
      fullName: 'Wrong Role',
      email: 'wrongrole@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'SUPERUSER',
    });

    expect(res.status).toBe(400);
  });

  it('does not allow unauthenticated callers to self-register as an administrator', async () => {
    const res = await registerViaApi({
      fullName: 'Attempted Admin',
      email: 'attempted-admin@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'ADMIN',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE email = 'attempted-admin@juniv.edu'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('reports the offending field', async () => {
    const res = await registerViaApi({
      fullName: '',
      email: 'valid@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    expect(res.status).toBe(400);
    const details = (res.body as { error: { details: Array<{ field: string }> } }).error.details;
    expect(details.some((d) => d.field === 'fullName')).toBe(true);
  });

  it('records an audit entry with no credential in it', async () => {
    await registerViaApi({
      fullName: 'Audited',
      email: 'audited@juniv.edu',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    });

    const rows = await query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_logs WHERE action = 'user.created' AND metadata->>'email' = 'audited@juniv.edu'`,
    );

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(TEACHER_PASSWORD);
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('$2');
  });
});

// =====================================================================
describe('POST /api/auth/login', () => {
  it('returns a token and the user for valid credentials', async () => {
    const res = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.expiresAt).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({ email: 'teacher@juniv.edu', role: 'TEACHER' });
  });

  it('never returns the password hash', async () => {
    const res = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('is case insensitive on the email', async () => {
    const res = await loginViaApi('TEACHER@juniv.edu', TEACHER_PASSWORD);
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const res = await loginViaApi('teacher@juniv.edu', 'WrongPassword123!');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    // Different messages would reveal which addresses have accounts.
    const unknown = await loginViaApi('nobody@juniv.edu', TEACHER_PASSWORD);
    const wrongPassword = await loginViaApi('teacher@juniv.edu', 'WrongPassword123!');

    expect(unknown.status).toBe(wrongPassword.status);
    expect({
      unknownBody: unknown.body,
      wrongPasswordBody: wrongPassword.body,
    }).toMatchObject({ unknownBody: wrongPassword.body });
  });

  it('rejects a deactivated account', async () => {
    await seedUser({ email: 'disabled@juniv.edu', role: 'TEACHER' });
    await query(`UPDATE users SET is_active = false WHERE email = 'disabled@juniv.edu'`);

    const { hashPassword } = await import('../../src/utils/password.js');
    await query(`UPDATE users SET password_hash = $1 WHERE email = 'disabled@juniv.edu'`, [
      await hashPassword(TEACHER_PASSWORD, TEST_BCRYPT_COST),
    ]);

    const res = await loginViaApi('disabled@juniv.edu', TEACHER_PASSWORD);
    expect(res.status).toBe(403);
  });

  it('creates a session row on sign-in', async () => {
    await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);

    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions WHERE revoked_at IS NULL`,
    );

    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });

  it('upgrades a hash created at a weaker cost', async () => {
    const { hashPassword, costOf } = await import('../../src/utils/password.js');

    await seedUser({ email: 'upgrademe@juniv.edu', role: 'TEACHER' });
    const weakHash = await hashPassword(TEACHER_PASSWORD, TEST_BCRYPT_COST - 2);
    await query(`UPDATE users SET password_hash = $1 WHERE email = 'upgrademe@juniv.edu'`, [
      weakHash,
    ]);

    expect(costOf(weakHash)).toBe(TEST_BCRYPT_COST - 2);

    const res = await loginViaApi('upgrademe@juniv.edu', TEACHER_PASSWORD);
    expect(res.status).toBe(200);

    const rows = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = 'upgrademe@juniv.edu'`,
    );

    expect(costOf(rows[0]!.password_hash)).toBe(TEST_BCRYPT_COST);
  });

  it('rejects a missing body field', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'teacher@juniv.edu' });
    expect(res.status).toBe(400);
  });
});

// =====================================================================
describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('teacher@juniv.edu');
  });

  it('rejects a missing token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign(
      { sub: '1', role: 'ADMIN', sid: 'x', tokenVersion: 1 },
      'wrong-secret-32-chars-long-enough-here',
      {
        algorithm: 'HS256',
        issuer: 'ju-meal-management',
        audience: 'ju-meal-management-client',
        expiresIn: 900,
      },
    );

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a Basic scheme header', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Basic dXNlcjpwYXNzd29yZA==');
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { signAccessToken } = await import('../../src/utils/token.js');
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const claims = jwtDecode(login.body.data.accessToken);

    // Re-sign with a zero lifetime, using our own secret.
    const expired = signAccessToken(
      {
        userId: Number(claims.sub),
        role: claims.role,
        permissions: [],
        tokenVersion: claims.tokenVersion,
        sessionId: claims.sid,
      },
      config.JWT_SECRET,
      0,
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired.accessToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose session was signed out', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const token = login.body.data.accessToken;

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose user was deactivated', async () => {
    await seedUser({ email: 'deactivated@juniv.edu', role: 'TEACHER' });
    const { hashPassword } = await import('../../src/utils/password.js');
    await query(`UPDATE users SET password_hash = $1 WHERE email = 'deactivated@juniv.edu'`, [
      await hashPassword(TEACHER_PASSWORD, TEST_BCRYPT_COST),
    ]);

    const login = await loginViaApi('deactivated@juniv.edu', TEACHER_PASSWORD);
    expect(login.status).toBe(200);

    await query(`UPDATE users SET is_active = false WHERE email = 'deactivated@juniv.edu'`);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects a token whose user was deleted', async () => {
    const id = await seedUser({ email: 'ghost@juniv.edu', role: 'TEACHER' });
    const { hashPassword } = await import('../../src/utils/password.js');
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await hashPassword(TEACHER_PASSWORD, TEST_BCRYPT_COST),
      id,
    ]);

    const login = await loginViaApi('ghost@juniv.edu', TEACHER_PASSWORD);
    await query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    await query(`DELETE FROM users WHERE id = $1`, [id]);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(401);
  });
});

// =====================================================================
describe('POST /api/auth/logout', () => {
  it('revokes the session so the token stops working at once', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const token = login.body.data.accessToken;

    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('does not affect another session for the same user', async () => {
    const first = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const second = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${first.body.data.accessToken}`);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated logout', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

// =====================================================================
describe('role and permission guards', () => {
  it('refuses a teacher on a staff-only endpoint', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);

    const res = await request(app)
      .get('/api/auth/staff-check')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a staff account', async () => {
    const login = await loginViaApi('staff@juniv.edu', STAFF_PASSWORD);

    const res = await request(app)
      .get('/api/auth/staff-check')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.allowed).toBe(true);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/auth/staff-check');
    expect(res.status).toBe(401);
  });

  it('always reports the same message for a refused role', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const res = await request(app)
      .get('/api/auth/staff-check')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.body.error.message).toBe('Your role does not allow this action.');
  });
});

// =====================================================================
describe('token revocation via token_version', () => {
  it('rejects a token after the stored token_version is bumped', async () => {
    const login = await loginViaApi('teacher@juniv.edu', TEACHER_PASSWORD);
    const token = login.body.data.accessToken as string;

    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(200);

    await query(
      `UPDATE users SET token_version = token_version + 1 WHERE email = 'teacher@juniv.edu'`,
    );

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

// =====================================================================
describe('login rate limiting', () => {
  it('returns 429 after too many failed attempts for one email', async () => {
    const email = 'ratelimited@juniv.edu';

    let lastStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword123!' });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});

/** Decode a token issued by the app, for building a modified copy. */
function jwtDecode(token: string): {
  sub: string;
  role: 'TEACHER' | 'STAFF' | 'ADMIN';
  tokenVersion: number;
  sid: string;
} {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as {
    sub: string;
    role: 'TEACHER' | 'STAFF' | 'ADMIN';
    tokenVersion: number;
    sid: string;
  };
}

describe('POST /api/auth/register in production', () => {
  it('requires authorized staff and keeps staff creation limited to teacher accounts', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    await query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions)
       VALUES ('Registration Admin', 'registration-admin@juniv.edu', $1, 'ADMIN', '[]'::jsonb),
              ('Registration Staff', 'registration-staff@juniv.edu', $1, 'STAFF', '["users:create"]'::jsonb)`,
      [await hashPassword('RegistrationPass123!', TEST_BCRYPT_COST)],
    );
    const productionApp = createApp({
      config: { ...config, NODE_ENV: 'production' },
      logger: silentLogger,
      db,
    });
    const anonymous = await request(productionApp).post('/api/auth/register').send({
      fullName: 'Anonymous',
      email: 'anon@juniv.edu',
      password: 'NewPassword123!',
      role: 'TEACHER',
    });
    expect(anonymous.status).toBe(401);

    const staffLogin = await request(productionApp).post('/api/auth/login').send({
      email: 'registration-staff@juniv.edu',
      password: 'RegistrationPass123!',
    });
    const staffToken = staffLogin.body.data.accessToken as string;
    const createdTeacher = await request(productionApp)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Created Teacher',
        email: 'created-teacher@juniv.edu',
        password: 'NewPassword123!',
        role: 'TEACHER',
      });
    expect(createdTeacher.status).toBe(201);
    const elevated = await request(productionApp)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Created Admin',
        email: 'created-admin@juniv.edu',
        password: 'NewPassword123!',
        role: 'ADMIN',
      });
    expect(elevated.status).toBe(400);

    const adminLogin = await request(productionApp).post('/api/auth/login').send({
      email: 'registration-admin@juniv.edu',
      password: 'RegistrationPass123!',
    });
    const adminToken = adminLogin.body.data.accessToken as string;
    const createdAdmin = await request(productionApp)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Created Admin',
        email: 'created-admin@juniv.edu',
        password: 'NewPassword123!',
        role: 'ADMIN',
      });
    expect(createdAdmin.status).toBe(201);
    expect(createdAdmin.body.data.role).toBe('ADMIN');
  });
});
