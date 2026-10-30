import type { Request, Response } from 'express';
import type { Database } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { deleteUser, updateUser } from '../services/user-admin.service.js';
import { presentUser } from '../views/auth.view.js';
import {
  listActiveTeachers as listActiveTeacherRows,
  listManagedUsers as listManagedUserRows,
} from '../models/user.model.js';
import { badRequest } from '../utils/errors.js';
import {
  requireBoolean,
  requireInt,
  requireObject,
  requireString,
  ValidationError,
} from '../utils/validation.js';
import { isValidEmail, issuePasswordReset, type AuthDeps } from '../services/auth.service.js';

export function patchUser(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const rawId = req.params['id'];
    if (typeof rawId !== 'string' || !/^\d+$/.test(rawId)) {
      throw badRequest('id must be a positive integer.');
    }
    const userId = requireInt(Number(rawId), 'id', { min: 1 });
    const body = requireObject(req.body ?? {}, 'body');
    const allowed = new Set(['isActive', 'fullName', 'email']);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw badRequest('Only isActive, fullName, and email may be changed.');

    let fullName: string | undefined;
    if (Object.hasOwn(body, 'fullName')) {
      fullName = requireString(body['fullName'], 'fullName', {
        minLength: 1,
        maxLength: 200,
      }).trim();
    }

    let email: string | undefined;
    if (Object.hasOwn(body, 'email')) {
      const emailStr = requireString(body['email'], 'email', { maxLength: 254 }).trim();
      if (!isValidEmail(emailStr)) {
        throw new ValidationError([
          { field: 'email', issue: 'invalid_format', message: 'email is not a valid address' },
        ]);
      }
      email = emailStr;
    }

    const input = {
      userId,
      actorId: actor.id,
      actorRole: actor.role,
      ...(Object.hasOwn(body, 'isActive')
        ? { isActive: requireBoolean(body['isActive'], 'isActive') }
        : {}),
      ...(fullName !== undefined ? { fullName } : {}),
      ...(email !== undefined ? { email } : {}),
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

export function removeUser(db: Database) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = currentUser(req);
    const rawId = req.params['id'];
    if (typeof rawId !== 'string' || !/^\d+$/.test(rawId)) {
      throw badRequest('id must be a positive integer.');
    }
    const userId = requireInt(Number(rawId), 'id', { min: 1 });
    const result = await deleteUser(db, {
      userId,
      actorId: actor.id,
      actorRole: actor.role,
    });
    res.status(200).json({ data: result });
  };
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

/** POST /api/staff/users/:id/password-reset; the one-time token is returned only to an admin. */
export function issuePasswordResetController(deps: AuthDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params['id'];
    if (typeof rawId !== 'string' || !/^\d+$/.test(rawId)) {
      throw badRequest('id must be a positive integer.');
    }
    const issued = await issuePasswordReset(
      deps,
      requireInt(Number(rawId), 'id', { min: 1 }),
      currentUser(req).id,
    );
    res
      .status(201)
      .json({ data: { token: issued.token, expiresAt: issued.expiresAt.toISOString() } });
  };
}
