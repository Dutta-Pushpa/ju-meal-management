import type { Role } from '@ju/shared';
import type { Database } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../models/audit.model.js';
import * as users from '../models/user.model.js';
import { conflict, notFound, unprocessable } from '../utils/errors.js';

export async function updateUser(
  db: Database,
  input: {
    userId: number;
    actorId: number;
    actorRole: Role;
    isActive?: boolean;
    fullName?: string;
    email?: string;
  },
) {
  return withTransaction(db, async (tx) => {
    const current = await users.lockUserForManagement(tx, input.userId);
    if (!current) throw notFound('User not found.');

    const isActive = input.isActive ?? current.is_active;

    // Prevent self-deactivation
    if (current.id === input.actorId && !isActive) {
      throw unprocessable(
        'INVALID_STATUS_TRANSITION',
        'You cannot deactivate your own account.',
      );
    }

    // The last active administrator cannot be deactivated
    if (
      current.role === 'ADMIN' &&
      current.is_active &&
      !isActive &&
      (await users.countOtherActiveAdmins(tx, current.id)) === 0
    ) {
      throw unprocessable(
        'INVALID_STATUS_TRANSITION',
        'The last active administrator cannot be deactivated.',
      );
    }

    // If email is changing, check uniqueness
    if (input.email && input.email.toLowerCase() !== current.email.toLowerCase()) {
      const existing = await users.findUserByEmail(tx, input.email);
      if (existing && existing.id !== current.id) {
        throw conflict('EMAIL_ALREADY_EXISTS', 'A user with this email address already exists.');
      }
    }

    const updated = await users.updateManagedUser(tx, current.id, {
      isActive,
      role: current.role,
      permissions: current.permissions,
      fullName: input.fullName,
      email: input.email,
    });
    await users.revokeManagedUserSessions(tx, updated.id);
    await writeAudit(tx, {
      actorUserId: input.actorId,
      action: 'user.updated',
      entityType: 'user',
      entityId: updated.id,
      metadata: {
        before: {
          fullName: current.full_name,
          email: current.email,
          role: current.role,
          permissions: current.permissions,
          isActive: current.is_active,
        },
        after: {
          fullName: updated.full_name,
          email: updated.email,
          role: updated.role,
          permissions: updated.permissions,
          isActive: updated.is_active,
        },
      },
    });
    return updated;
  });
}

export async function deleteUser(
  db: Database,
  input: {
    userId: number;
    actorId: number;
    actorRole: Role;
  },
) {
  return withTransaction(db, async (tx) => {
    const current = await users.lockUserForManagement(tx, input.userId);
    if (!current) throw notFound('User not found.');

    if (current.id === input.actorId) {
      throw unprocessable('INVALID_STATUS_TRANSITION', 'You cannot delete your own account.');
    }

    if (current.role === 'ADMIN' && (await users.countOtherActiveAdmins(tx, current.id)) === 0) {
      throw unprocessable('INVALID_STATUS_TRANSITION', 'The last administrator cannot be deleted.');
    }

    await users.revokeManagedUserSessions(tx, current.id);

    try {
      await users.deleteUserById(tx, current.id);
    } catch (err: unknown) {
      const error = err as { code?: string };
      // 23503 is PostgreSQL foreign_key_violation
      if (error.code === '23503') {
        throw unprocessable(
          'INVALID_STATUS_TRANSITION',
          'This user has associated historical records (such as orders or ledger entries) and cannot be deleted. You can deactivate the account instead.',
        );
      }
      throw err;
    }

    await writeAudit(tx, {
      actorUserId: input.actorId,
      action: 'user.deleted',
      entityType: 'user',
      entityId: current.id,
      metadata: {
        deletedUser: {
          id: current.id,
          fullName: current.full_name,
          email: current.email,
          role: current.role,
        },
      },
    });

    return { id: current.id };
  });
}
