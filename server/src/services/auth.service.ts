import type { Permission, Role } from '@ju/shared';
import { conflict, forbidden, unauthorized } from '../utils/errors.js';
import {
  PASSWORD_MIN_LENGTH,
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../utils/password.js';
import { type IssuedToken, signAccessToken, verifyAccessToken } from '../utils/token.js';
import { isUniqueViolation } from '../utils/pg-errors.js';
import * as users from '../models/user.model.js';
import { writeAudit } from '../models/audit.model.js';
import type { Database, Queryable, TransactionClient } from '../db/pool.js';

/**
 * Authentication and account creation.
 *
 * Every rule here is server-side. The client is never trusted to say who a user
 * is, what role they have, or what a password costs.
 */

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  designation?: string | null;
  permissions: Permission[];
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  role: 'TEACHER' | 'STAFF' | 'ADMIN';
  designation?: string | null;
  adminKey?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  role?: string | null;
}

export interface RequestMeta {
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

export interface LoginResult {
  user: AuthUser;
  token: IssuedToken;
}

export interface AuthDeps {
  db: Database;
  jwtSecret: string;
  tokenLifetimeMinutes: number;
  bcryptCost: number;
  adminKey?: string;
}

function toAuthUser(row: users.UserRow): AuthUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    designation: row.designation ?? null,
    // A TEACHER never carries permissions, whatever the row says. The
    // permission list is only meaningful for staff and admin accounts.
    permissions: row.role === 'TEACHER' ? [] : (row.permissions ?? []),
    role: row.role,
  };
}

/** Basic email shape check. Deliberately permissive; deliverability is not knowable here. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * Create a user.
 *
 * The password is checked for acceptability and hashed here, so no caller can
 * store an unhashed or oversized value by forgetting to.
 */
export async function registerUser(
  deps: AuthDeps,
  input: RegisterInput,
  actor: AuthUser | undefined,
): Promise<AuthUser> {
  assertPasswordAcceptable(input.password);

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password, deps.bcryptCost);

  // TEACHER and STAFF accounts are never given permissions. Granting them at
  // creation would create an account that could act beyond its role.
  const permissions: Permission[] = [];

  // ADMIN registration requires the shared admin key, validated server-side,
  // unless an existing administrator is creating the account.
  // The key is never echoed back in responses or audit metadata.
  if (input.role === 'ADMIN' && actor?.role !== 'ADMIN') {
    if (!input.adminKey || input.adminKey !== deps.adminKey) {
      throw forbidden('The admin key is incorrect or missing.');
    }
  }

  try {
    const user = await users.insertUser(deps.db, {
      fullName: input.fullName.trim(),
      email,
      passwordHash,
      role: input.role,
      permissions,
    });

    await writeAudit(deps.db, {
      actorUserId: actor?.id,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      // No password, no hash, no admin key. The metadata column is readable by
      // anyone with audit access, so it must never hold a credential or secret.
      metadata: { email: user.email, role: user.role, viaSelfRegistration: actor === undefined },
    });

    return toAuthUser(user);
  } catch (error) {
    // The unique index on lower(email) is what actually enforces uniqueness;
    // this branch only turns it into a meaningful message.
    if (isUniqueViolation(error)) {
      throw conflict('EMAIL_ALREADY_EXISTS', 'An account with that email address already exists.');
    }
    throw error;
  }
}

/**
 * Verify credentials and issue a token.
 *
 * A wrong email and a wrong password produce the same error, deliberately. A
 * different message would let someone enumerate which addresses have accounts.
 */
export async function login(
  deps: AuthDeps,
  input: LoginInput,
  meta: RequestMeta,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await users.findUserByEmail(deps.db, email);

  if (!user) {
    // Still hash something, so a missing account and a wrong password take
    // comparable time and cannot be told apart by timing.
    await hashPassword(input.password, deps.bcryptCost);
    throw unauthorized('The email or password is incorrect.');
  }

  const passwordMatches = await verifyPassword(input.password, user.password_hash);

  if (!passwordMatches) {
    throw unauthorized('The email or password is incorrect.');
  }

  if (!user.is_active) {
    // Deliberately after the password check, so this cannot be used to probe for
    // whether an account exists.
    throw forbidden('This account has been deactivated. Contact an administrator.');
  }

  // Validate the requested login role against the user's actual role. A teacher
  // cannot log in as staff or admin, and vice versa. When no role is sent, the
  // user's actual role is used.
  const requestedRole = input.role ?? user.role;
  if (requestedRole !== user.role) {
    throw forbidden(`The selected role does not match your account role (${user.role}).`);
  }

  // Upgrade the stored hash if it was made at a weaker cost than the current
  // setting. This is what makes raising BCRYPT_COST safe for existing accounts.
  if (needsRehash(user.password_hash, deps.bcryptCost)) {
    const upgraded = await hashPassword(input.password, deps.bcryptCost);
    await users.updatePasswordHash(deps.db, user.id, upgraded);
  }

  const expiresAt = new Date(Date.now() + deps.tokenLifetimeMinutes * 60_000);
  const sessionId = await users.insertSession(deps.db, {
    userId: user.id,
    tokenVersion: user.token_version,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    expiresAt,
  });

  const token = signAccessToken(
    {
      userId: user.id,
      role: user.role,
      permissions: toAuthUser(user).permissions,
      tokenVersion: user.token_version,
      sessionId,
    },
    deps.jwtSecret,
    deps.tokenLifetimeMinutes,
  );

  await writeAudit(deps.db, {
    actorUserId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    metadata: { sessionId },
  });

  return { user: toAuthUser(user), token };
}

/**
 * Resolve a bearer token to the user it identifies.
 *
 * Both checks must pass: the token must verify cryptographically, and the
 * session behind it must still be live. Verifying only the signature would mean
 * a token kept after logout still worked until it expired.
 *
 * This costs one database lookup per authenticated request. That is the price
 * of real revocation, and at this system's scale it is a fair trade.
 */
export async function resolveToken(
  db: Queryable,
  token: string,
  jwtSecret: string,
): Promise<AuthUser> {
  const claims = verifyAccessToken(token, jwtSecret);

  const session = await users.findActiveSession(db, claims.sid, claims.tokenVersion);

  if (!session) {
    throw unauthorized('This session has been signed out.');
  }

  const user = await users.findUserById(db, Number(claims.sub));

  if (!user) {
    throw unauthorized('The account for this token no longer exists.');
  }

  if (!user.is_active) {
    throw forbidden('This account has been deactivated.');
  }

  if (user.token_version !== claims.tokenVersion) {
    throw unauthorized('This token has been revoked.');
  }

  return toAuthUser(user);
}

/** Revoke the session behind a token, so the token stops working immediately. */
export async function logout(db: Queryable, token: string, jwtSecret: string): Promise<void> {
  const claims = verifyAccessToken(token, jwtSecret);
  await users.revokeSession(db, claims.sid);
}

/**
 * Reject every session and token for a user.
 *
 * Used when a password changes or an account is deactivated, where keeping
 * existing tokens alive would defeat the purpose.
 */
export async function revokeAllForUser(db: TransactionClient, userId: number): Promise<void> {
  await users.bumpTokenVersion(db, userId);
  await users.revokeAllSessionsForUser(db, userId);
}

export const PASSWORD_POLICY_MIN_LENGTH = PASSWORD_MIN_LENGTH;
