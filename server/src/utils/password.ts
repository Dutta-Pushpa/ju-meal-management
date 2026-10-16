import bcrypt from 'bcrypt';
import { ValidationError } from './validation.js';

/**
 * Password hashing with bcrypt.
 *
 * Four rules follow from how bcrypt actually behaves. All four are covered by
 * tests, because each of them is a rule that is easy to believe is handled and
 * silently is not.
 */

/** bcrypt truncates its input at 72 bytes, so anything longer is refused. */
export const BCRYPT_MAX_BYTES = 72;

/** Minimum length in characters. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * bcrypt's alphabet cannot express a meaningful strength in characters. A cap
 * on characters keeps an absurd payload out of the hashing path while staying
 * far above the byte limit for any realistic passphrase.
 */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Validate a password before it is ever hashed.
 *
 * The length check is on the UTF-8 **byte** length, not the character count.
 * A Bengali or other multibyte password can look comfortably short while
 * exceeding 72 bytes, and bcrypt would then silently hash only its prefix. Two
 * passwords sharing that prefix would be interchangeable, which is exactly the
 * failure the limit exists to prevent.
 *
 * @throws {ValidationError} when the password is unacceptable
 */
export function assertPasswordAcceptable(password: string, field = 'password'): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError([
      {
        field,
        issue: 'too_small',
        message: `${field} must be at least ${PASSWORD_MIN_LENGTH} characters`,
      },
    ]);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError([
      {
        field,
        issue: 'too_big',
        message: `${field} must be at most ${PASSWORD_MAX_LENGTH} characters`,
      },
    ]);
  }

  const bytes = Buffer.byteLength(password, 'utf8');

  if (bytes > BCRYPT_MAX_BYTES) {
    throw new ValidationError([
      {
        field,
        issue: 'too_long',
        message:
          `${field} must be at most ${BCRYPT_MAX_BYTES} bytes when encoded as UTF-8 ` +
          `(this password is ${bytes} bytes). bcrypt ignores anything beyond that, ` +
          'so a longer password would not be fully checked at sign-in.',
      },
    ]);
  }
}

/**
 * Hash a password.
 *
 * The async API is used deliberately: bcrypt is intentionally slow, and the
 * callback version would block the event loop for the duration of the hash.
 */
export async function hashPassword(plain: string, cost: number): Promise<string> {
  return bcrypt.hash(plain, cost);
}

/**
 * Compare a password against a stored hash.
 *
 * Returns false for any failure, including a malformed stored hash, so a
 * corrupted record cannot become a way in.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was made with a weaker cost than the current setting.
 *
 * Re-hashing on the next successful sign-in is what makes it safe to raise the
 * cost factor later: existing accounts are upgraded gradually, as each user
 * next logs in, rather than being left on an old cost indefinitely.
 */
export function needsRehash(hash: string, currentCost: number): boolean {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);

  if (!match) {
    // An unrecognised format is treated as needing replacement.
    return true;
  }

  return Number(match[1]) < currentCost;
}

/** The cost a hash was created with, for logging and tests. */
export function costOf(hash: string): number | undefined {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  return match ? Number(match[1]) : undefined;
}
