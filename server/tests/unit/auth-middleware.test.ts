import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { currentUser, requireRole } from '../../src/middleware/auth.js';
import type { AuthUser } from '../../src/services/auth.service.js';

/**
 * Authorisation guards, without HTTP or a database.
 *
 * These run the middleware with a stub request carrying (or missing) `auth`,
 * which is exactly what `requireAuth` attaches. The database is not involved:
 * by this point authentication has already resolved the user.
 */

function stubReq(user: AuthUser | undefined): Request {
  return { auth: user } as Request;
}

function stubRes(): Response {
  return {} as Response;
}

const teacher: AuthUser = {
  id: 1,
  fullName: 'A. Teacher',
  email: 'teacher@juniv.edu',
  role: 'TEACHER',
  permissions: [],
};

const collector: AuthUser = {
  id: 2,
  fullName: 'Demo Staff',
  email: 'staff@juniv.edu',
  role: 'STAFF',
  permissions: [],
};

function run(
  middleware: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
): Promise<unknown> {
  return new Promise((resolve) => {
    middleware(req, stubRes(), (err?: unknown) => resolve(err));
  });
}

describe('requireRole', () => {
  it('allows a listed role', async () => {
    const err = await run(requireRole('STAFF', 'ADMIN'), stubReq(collector));
    expect(err).toBeUndefined();
  });

  it('refuses an unlisted role with 403', async () => {
    const err = (await run(requireRole('STAFF', 'ADMIN'), stubReq(teacher))) as {
      status: number;
      code: string;
    };
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('refuses a missing user with 401', async () => {
    const err = (await run(requireRole('STAFF'), stubReq(undefined))) as {
      status: number;
      code: string;
    };
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('grants access by role alone — stored permissions are irrelevant', async () => {
    const staffWithPerms: AuthUser = { ...collector, permissions: ['budgets:allocate'] };
    const err = await run(requireRole('STAFF', 'ADMIN'), stubReq(staffWithPerms));
    expect(err).toBeUndefined();
  });
});

describe('currentUser', () => {
  it('returns the attached user', () => {
    expect(currentUser(stubReq(teacher))).toBe(teacher);
  });

  it('throws UNAUTHORIZED without a user', () => {
    try {
      currentUser(stubReq(undefined));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { status: number }).status).toBe(401);
    }
  });

  it('exposes ROLES and PERMISSIONS for controllers to share', async () => {
    const { ROLES, PERMISSIONS } = await import('../../src/middleware/auth.js');
    expect(ROLES).toContain('TEACHER');
    expect(PERMISSIONS).toContain('orders:manage_status');
  });
});
