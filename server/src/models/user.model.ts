import type { Permission, Role } from '@ju/shared';
import type { Queryable } from '../db/pool.js';

/**
 * Users and sessions.
 *
 * Every query here is parameterised. String interpolation into SQL is not
 * permitted anywhere in this codebase, so a value that needs to be dynamic, such
 * as a filter column, is chosen from a fixed allow-list in the service layer
 * rather than concatenated.
 */

export interface UserRow {
  id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role: Role;
  permissions: Permission[];
  is_active: boolean;
  token_version: number;
  created_at: Date;
  updated_at: Date;
}

/** Columns that are always returned. The password hash is added only where needed. */
const USER_COLUMNS = `
  id, full_name, email, password_hash, role, permissions, is_active,
  token_version, created_at, updated_at
`;

export interface CreateUserInput {
  fullName: string;
  email: string;
  passwordHash: string;
  role: Role;
  permissions: Permission[];
}

export async function insertUser(db: Queryable, input: CreateUserInput): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (full_name, email, password_hash, role, permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING ${USER_COLUMNS}`,
    [
      input.fullName,
      input.email,
      input.passwordHash,
      input.role,
      JSON.stringify(input.permissions),
    ],
  );

  return rows[0]!;
}

/** Look up by email. The caller passes an already lower-cased address. */
export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | undefined> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );

  return rows[0];
}

export async function findUserById(db: Queryable, id: number): Promise<UserRow | undefined> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );

  return rows[0];
}

export async function lockUserForManagement(
  db: Queryable,
  userId: number,
): Promise<UserRow | undefined> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  return rows[0];
}

export async function countOtherActiveAdmins(db: Queryable, userId: number): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND is_active AND id <> $1`,
    [userId],
  );
  return rows[0]!.count;
}

/**
 * Lock an active teacher row and report whether it exists.
 *
 * The row lock is what serialises concurrent orders by the same teacher, so
 * two simultaneous requests cannot both read the same balance and both
 * succeed. It is taken before the balance is read, inside the order
 * transaction.
 */
export async function lockActiveTeacher(db: Queryable, teacherId: number): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND role = 'TEACHER' AND is_active FOR UPDATE`,
    [teacherId],
  );
  return rows.length > 0;
}

export async function updateManagedUser(
  db: Queryable,
  userId: number,
  input: { isActive: boolean; role: Role; permissions: Permission[] },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET is_active = $2, role = $3, permissions = $4::jsonb,
            token_version = token_version + 1, updated_at = now()
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId, input.isActive, input.role, JSON.stringify(input.permissions)],
  );
  return rows[0]!;
}

export async function revokeManagedUserSessions(db: Queryable, userId: number): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

/**
 * Replace a password hash.
 *
 * Used after a successful sign-in to upgrade an account that was hashed at a
 * weaker cost than the current setting.
 */
export async function updatePasswordHash(
  db: Queryable,
  userId: number,
  passwordHash: string,
): Promise<void> {
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

export interface CreateSessionInput {
  userId: number;
  tokenVersion: number;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  expiresAt: Date;
}

export async function insertSession(db: Queryable, input: CreateSessionInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_version, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.userId,
      input.tokenVersion,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.expiresAt,
    ],
  );

  return rows[0]!.id;
}

export interface SessionRow {
  id: string;
  user_id: number;
  revoked_at: Date | null;
  expires_at: Date;
  token_version: number;
}

/**
 * Fetch a session only if it is still usable.
 *
 * The token version must also match: a session created before a password change
 * or an explicit revocation must not come back to life.
 */
export async function findActiveSession(
  db: Queryable,
  sessionId: string,
  expectedTokenVersion: number,
): Promise<SessionRow | undefined> {
  const { rows } = await db.query<SessionRow>(
    `SELECT id, user_id, revoked_at, expires_at, token_version
     FROM sessions
     WHERE id = $1
       AND revoked_at IS NULL
       AND expires_at > now()
       AND token_version = $2
     LIMIT 1`,
    [sessionId, expectedTokenVersion],
  );

  return rows[0];
}

export async function revokeSession(db: Queryable, sessionId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );

  return (result.rowCount ?? 0) > 0;
}
