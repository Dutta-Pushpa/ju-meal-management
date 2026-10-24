import type { ApiSuccessResponse, Permission, Role } from '@ju/shared';
import type { AuthUser } from '../services/auth.service.js';

/**
 * Response presenters.
 *
 * Views are pure functions that turn model output into the public JSON shape.
 * They contain no database access and no business rules, which is what keeps
 * the wire format in one place instead of spread across controllers.
 */

export interface UserView {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  designation?: string | null;
  permissions: Permission[];
  isActive: boolean;
  createdAt: string;
}

/**
 * Present a user.
 *
 * `password_hash` is never part of this function's input, which is deliberate:
 * there is no code path that can add it by accident later.
 */
export function presentUser(
  user: Pick<AuthUser, 'id' | 'fullName' | 'email' | 'role' | 'permissions'> & {
    designation?: string | null;
    isActive?: boolean;
    createdAt?: Date;
  },
): UserView {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    designation: user.designation ?? null,
    permissions: user.permissions,
    isActive: user.isActive ?? true,
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };
}

export interface SessionView {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: UserView;
}

export function presentLogin(
  user: UserView,
  token: { accessToken: string; tokenType: 'Bearer'; expiresAt: Date },
): ApiSuccessResponse<SessionView> {
  return {
    data: {
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt.toISOString(),
      user,
    },
  };
}
