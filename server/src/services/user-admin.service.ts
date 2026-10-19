import type { Permission, Role } from '@ju/shared';
import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../models/audit.model.js';
import * as users from '../models/user.model.js';
import { badRequest, forbidden, notFound, unprocessable } from '../utils/errors.js';

export async function updateUser(
  db: Database,
  input: {
    userId: number;
    actorId: number;
    actorRole: Role;
    isActive?: boolean;
    role?: Role;
    permissions?: Permission[];
  },
) {
  return withTransaction(db, async (tx) => {
    // Serialise administrative role changes so two requests cannot both remove
    // the last active administrator based on the same stale count.
    if (input.actorRole === 'ADMIN') await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const current = await users.lockUserForManagement(tx, input.userId);
    if (!current) throw notFound('User not found.');

    if (
      input.actorRole === 'STAFF' &&
      (current.role !== 'TEACHER' || input.role || input.permissions)
    ) {
      throw forbidden('Staff with users:manage may only activate or deactivate teacher accounts.');
    }
    if (
      input.isActive === undefined &&
      input.role === undefined &&
      input.permissions === undefined
    ) {
      throw badRequest('At least one user field must be provided.');
    }

    const role = input.role ?? current.role;
    if (role === 'TEACHER' && input.permissions?.length) {
      throw badRequest('Teacher accounts cannot have permissions.');
    }
    const permissions = role === 'TEACHER' ? [] : (input.permissions ?? current.permissions);
    const isActive = input.isActive ?? current.is_active;
    if (
      current.role === 'ADMIN' &&
      current.is_active &&
      (role !== 'ADMIN' || !isActive) &&
      (await users.countOtherActiveAdmins(tx, current.id)) === 0
    ) {
      throw unprocessable(
        'INVALID_STATUS_TRANSITION',
        'The last active administrator cannot be removed.',
      );
    }

    const updated = await users.updateManagedUser(tx, current.id, { isActive, role, permissions });
    await users.revokeManagedUserSessions(tx, updated.id);
    await writeAudit(tx, {
      actorUserId: input.actorId,
      action: 'user.updated',
      entityType: 'user',
      entityId: updated.id,
      metadata: {
        before: {
          role: current.role,
          permissions: current.permissions,
          isActive: current.is_active,
        },
        after: {
          role: updated.role,
          permissions: updated.permissions,
          isActive: updated.is_active,
        },
      },
    });
    return updated;
  });
}
