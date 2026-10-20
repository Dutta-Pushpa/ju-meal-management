import { PERMISSIONS, ROLES, type Permission } from '@ju/shared';
import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { updateUser } from '../services/user-admin.service.js';
import { presentUser } from '../views/auth.view.js';
import { badRequest } from '../utils/errors.js';
import { requireBoolean, requireEnum, requireObject } from '../utils/validation.js';
import { hasField, readPathId } from '../utils/request.js';

export function patchUser(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const userId = readPathId(req);
    const body = requireObject(req.body ?? {}, 'body');
    const allowed = new Set(['isActive', 'role', 'permissions']);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw badRequest('body contains an unsupported field.');
    const input: Parameters<typeof updateUser>[1] = {
      userId,
      actorId: actor.id,
      actorRole: actor.role,
      ...(hasField(body, 'isActive')
        ? { isActive: requireBoolean(body['isActive'], 'isActive') }
        : {}),
      ...(hasField(body, 'role') ? { role: requireEnum(body['role'], 'role', ROLES) } : {}),
      ...(hasField(body, 'permissions')
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
