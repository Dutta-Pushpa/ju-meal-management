import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import {
  currentUser,
  requirePermission,
  requireRole,
  requireRoleWithPermission,
} from '../../src/middleware/auth.js';
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
  email: 'teacher@example.edu',
  role: 'TEACHER',
  permissions: [],
};

const collector: AuthUser = {
  id: 2,
  fullName: 'Demo Staff',
  email: 'staff@example.edu',
  role: 'STAFF',
  permissions: ['orders:manage_status'],
};

const admin: AuthUser = {
  id: 3,
  fullName: 'Admin',
  email: 'admin@example.edu',
  role: 'ADMIN',
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
});

describe('requirePermission', () => {
  it('allows a staff account holding the permission', async () => {
    const err = await run(requirePermission('orders:manage_status'), stubReq(collector));
    expect(err).toBeUndefined();
  });

  it('refuses a staff account without the permission', async () => {
    const noPerms: AuthUser = { ...collector, permissions: [] };
    const err = (await run(requirePermission('budgets:allocate'), stubReq(noPerms))) as {
      status: number;
      code: string;
      message: string;
    };
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    // The missing permission name is not echoed, so callers cannot map the model.
    expect(err.message).not.toContain('budgets:allocate');
  });

  it('refuses a teacher even when they hold no permissions', async () => {
    const err = (await run(requirePermission('orders:manage_status'), stubReq(teacher))) as {
      status: number;
    };
    expect(err.status).toBe(403);
  });
});

describe('requireRoleWithPermission', () => {
  it('allows staff with the permission', async () => {
    const err = await run(
      requireRoleWithPermission(['STAFF'], 'orders:manage_status'),
      stubReq(collector),
    );
    expect(err).toBeUndefined();
  });

  it('refuses staff without the permission', async () => {
    const err = (await run(
      requireRoleWithPermission(['STAFF'], 'budgets:allocate'),
      stubReq(collector),
    )) as { status: number };
    expect(err.status).toBe(403);
  });

  it('refuses a teacher even with a matching permission list', async () => {
    const teacherWithPerms: AuthUser = {
      ...teacher,
      permissions: ['orders:manage_status'],
    };
    const err = (await run(
      requireRoleWithPermission(['STAFF'], 'orders:manage_status'),
      stubReq(teacherWithPerms),
    )) as { status: number };
    expect(err.status).toBe(403);
  });

  it('lets ADMIN through without holding the permission', async () => {
    const err = await run(requireRoleWithPermission(['STAFF'], 'budgets:allocate'), stubReq(admin));
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
