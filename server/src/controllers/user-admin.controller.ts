import { PERMISSIONS, ROLES, type Permission } from '@ju/shared';
import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { updateUser } from '../services/user-admin.service.js';
import { presentUser } from '../views/auth.view.js';
import { listActiveTeachers as listActiveTeacherRows, listManagedUsers as listManagedUserRows } from '../models/user.model.js';
import { badRequest } from '../utils/errors.js';
import { requireBoolean, requireEnum, requireInt, requireObject } from '../utils/validation.js';

export function patchUser(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const rawId = req.params['id'];
    if (typeof rawId !== 'string' || !/^\d+$/.test(rawId)) {
      throw badRequest('id must be a positive integer.');
    }
    const userId = requireInt(Number(rawId), 'id', { min: 1 });
    const body = requireObject(req.body ?? {}, 'body');
    const allowed = new Set(['isActive', 'role', 'permissions']);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw badRequest('body contains an unsupported field.');
    const input: Parameters<typeof updateUser>[1] = {
      userId,
      actorId: actor.id,
      actorRole: actor.role,
      ...(Object.hasOwn(body, 'isActive')
        ? { isActive: requireBoolean(body['isActive'], 'isActive') }
        : {}),
      ...(Object.hasOwn(body, 'role') ? { role: requireEnum(body['role'], 'role', ROLES) } : {}),
      ...(Object.hasOwn(body, 'permissions')
        ? { permissions: parsePermissions(body['permissions']) }
        : {}),
    };
    const updated = await updateUser(db, input);
    res.status(200).json({
      data: presentUser({
        id: updated.id,
        fullName: updated.full_name,
        email: updated.email,
        role: updated.role,
        designation: updated.designation ?? null,
        permissions: updated.permissions,
        isActive: updated.is_active,
        createdAt: updated.created_at,
      }),
    });
  };
}

function parsePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) throw badRequest('permissions must be an array.');
  const permissions = value.map((permission, index) =>
    requireEnum(permission, `permissions[${index}]`, PERMISSIONS),
  );
  return [...new Set(permissions)];
}

/** GET /api/staff/users — safe, non-secret user directory for authorized managers. */
export function listManagedUsers(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listManagedUserRows(db);
    res.status(200).json({
      data: rows.map((row) =>
        presentUser({
          id: row.id,
          fullName: row.full_name,
          email: row.email,
          role: row.role,
          designation: row.designation,
          permissions: row.permissions,
          isActive: row.is_active,
          createdAt: row.created_at,
        }),
      ),
      meta: { total: rows.length },
    });
  };
}

/** GET /api/staff/teachers — active teacher choices for budget allocation forms. */
export function listActiveTeachers(db: Database) {
  return async (_req: Request, res: Response): Promise<void> => {
    const rows = await listActiveTeacherRows(db);
    res.status(200).json({
      data: rows.map((row) => ({ id: row.id, fullName: row.full_name, email: row.email })),
      meta: { total: rows.length },
    });
  };
}
