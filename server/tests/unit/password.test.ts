import { describe, expect, it } from 'vitest';
import {
  BCRYPT_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  assertPasswordAcceptable,
  costOf,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../src/utils/password.js';
import { ValidationError } from '../../src/utils/validation.js';

/**
 * Password hashing rules.
 *
 * These matter because each one is a rule that is easy to believe is handled
 * and silently is not. bcrypt truncates at 72 bytes without complaint, so an
 * un-validated password can produce two interchangeable credentials.
 */

// The lowest cost bcrypt accepts, to keep the suite fast. Production uses 12.
const TEST_COST = 10;

describe('assertPasswordAcceptable', () => {
  it('accepts a normal password', () => {
    expect(() => assertPasswordAcceptable('CorrectHorse9!')).not.toThrow();
  });

  it('rejects a password shorter than the minimum', () => {
    expect(() => assertPasswordAcceptable('Short1!')).toThrow(ValidationError);
    expect(() => assertPasswordAcceptable('Short1!')).toThrow(/at least 12 characters/);
  });

  it('rejects a password longer than the character cap', () => {
    expect(() => assertPasswordAcceptable('a'.repeat(500))).toThrow(/at most 200 characters/);
  });

  it(`rejects a password longer than ${BCRYPT_MAX_BYTES} UTF-8 bytes`, () => {
    // 30 three-byte Bengali characters is 90 bytes but only 30 characters, so a
    // character-count check would wrongly accept it.
    const multibyte = 'আ'.repeat(30);

    expect(multibyte).toHaveLength(30);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(BCRYPT_MAX_BYTES);

    expect(() => assertPasswordAcceptable(multibyte)).toThrow(/bytes when encoded as UTF-8/);
  });

  it('accepts a password just inside the byte limit', () => {
    // 24 four-byte characters is exactly 96 bytes, too long. 18 gives 72.
    const exact = '😀'.repeat(18);
    expect(Buffer.byteLength(exact, 'utf8')).toBe(BCRYPT_MAX_BYTES);

    expect(() => assertPasswordAcceptable(exact)).not.toThrow();
  });

  it('reports the field name so the API can point at it', () => {
    try {
      assertPasswordAcceptable('short', 'newPassword');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.field).toBe('newPassword');
    }
  });
});

describe('hash and verify', () => {
  it('produces a bcrypt hash, never the password', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);

    expect(hash).not.toContain('CorrectHorse9!');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
  });

  it('produces a different hash each time, so identical passwords differ at rest', async () => {
    const first = await hashPassword('CorrectHorse9!', TEST_COST);
    const second = await hashPassword('CorrectHorse9!', TEST_COST);

    expect(first).not.toBe(second);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);
    await expect(verifyPassword('CorrectHorse9!', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);
    await expect(verifyPassword('WrongHorse9!', hash)).resolves.toBe(false);
  });

  it('returns false rather than throwing on a corrupted hash', async () => {
    await expect(verifyPassword('CorrectHorse9!', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('CorrectHorse9!', '')).resolves.toBe(false);
  });

  it('cannot distinguish two passwords that share a prefix beyond 72 bytes', async () => {
    // This is the failure the byte limit prevents. bcrypt ignores the tail, so
    // without validation these two would be interchangeable.
    const base = 'a'.repeat(BCRYPT_MAX_BYTES);
    const first = await hashPassword(base, TEST_COST);
    const second = await hashPassword(`${base}DIFFERENT-TAIL`, TEST_COST);

    // Demonstrating the underlying bcrypt behaviour, which is why the byte cap
    // is enforced rather than left to chance.
    await expect(verifyPassword(base, first)).resolves.toBe(true);
    // The second hash was made from base plus a tail, but bcrypt truncated the
    // input, so the base password still verifies against it.
    await expect(verifyPassword(base, second)).resolves.toBe(true);
    expect(base.length).toBe(PASSWORD_MIN_LENGTH * 6);
  });
});

describe('needsRehash', () => {
  it('reports no need when the cost matches', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);
    expect(needsRehash(hash, TEST_COST)).toBe(false);
  });

  it('reports a need when the stored cost is weaker than current', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);
    expect(needsRehash(hash, TEST_COST + 1)).toBe(true);
  });

  it('reports no need when the stored cost is stronger than current', async () => {
    const hash = await hashPassword('CorrectHorse9!', 12);
    expect(needsRehash(hash, 10)).toBe(false);
  });

  it('treats an unrecognised hash as needing replacement', () => {
    expect(needsRehash('legacy-md5-hash', 12)).toBe(true);
  });
});

describe('costOf', () => {
  it('reads the cost back out of a hash', async () => {
    const hash = await hashPassword('CorrectHorse9!', TEST_COST);
    expect(costOf(hash)).toBe(TEST_COST);
  });

  it('returns undefined for an unrecognised hash', () => {
    expect(costOf('nonsense')).toBeUndefined();
  });
});
