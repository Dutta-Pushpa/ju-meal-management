import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Permission } from '@ju/shared';
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  signAccessToken,
  tokenFromHeader,
  verifyAccessToken,
} from '../../src/utils/token.js';
import { AppError } from '../../src/utils/errors.js';

/**
 * Token issuing and verification.
 */

const SECRET = 'unit-test-secret-that-is-long-enough-32';
const OTHER_SECRET = 'a-different-secret-also-long-enough-32';

const claims = {
  userId: 42,
  role: 'STAFF' as const,
  permissions: ['orders:manage_status'] as Permission[],
  tokenVersion: 3,
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
};

describe('signAccessToken', () => {
  it('issues a token carrying the expected claims', () => {
    const issued = signAccessToken(claims, SECRET, 15);
    const decoded = verifyAccessToken(issued.accessToken, SECRET);

    expect(decoded.sub).toBe('42');
    expect(decoded.role).toBe('STAFF');
    expect(decoded.permissions).toEqual(['orders:manage_status']);
    expect(decoded.tokenVersion).toBe(3);
    expect(decoded.sid).toBe(claims.sessionId);
  });

  it('sets an expiry matching the requested lifetime', () => {
    const issued = signAccessToken(claims, SECRET, 15);
    const seconds = Math.round(issued.expiresAt.getTime() / 1000) - Math.round(Date.now() / 1000);

    expect(seconds).toBeGreaterThanOrEqual(14 * 60);
    expect(seconds).toBeLessThanOrEqual(15 * 60 + 2);
  });

  it('reports the token type as Bearer', () => {
    expect(signAccessToken(claims, SECRET, 15).tokenType).toBe('Bearer');
  });
});

describe('verifyAccessToken', () => {
  it('rejects a token signed with a different secret', () => {
    const issued = signAccessToken(claims, OTHER_SECRET, 15);
    expect(() => verifyAccessToken(issued.accessToken, SECRET)).toThrow(AppError);
  });

  it('rejects a token with no signature', () => {
    const unsigned = jwt.sign({ sub: '42', role: 'ADMIN' }, '', { algorithm: 'none' });

    expect(() => verifyAccessToken(unsigned, SECRET)).toThrow(/invalid or has expired/);
  });

  it('rejects an expired token', () => {
    // Lifetime of zero seconds, so it is already outside its validity window.
    const expired = signAccessToken(claims, SECRET, 0);

    expect(() => verifyAccessToken(expired.accessToken, SECRET)).toThrow(/invalid or has expired/);
  });

  it('rejects a token with a wrong issuer', () => {
    const wrong = jwt.sign({ sub: '42', sid: 'x', tokenVersion: 1 }, SECRET, {
      algorithm: 'HS256',
      issuer: 'somebody-else',
      audience: TOKEN_AUDIENCE,
      expiresIn: 900,
    });

    expect(() => verifyAccessToken(wrong, SECRET)).toThrow(/invalid or has expired/);
  });

  it('rejects a token with a wrong audience', () => {
    const wrong = jwt.sign({ sub: '42', sid: 'x', tokenVersion: 1 }, SECRET, {
      algorithm: 'HS256',
      issuer: TOKEN_ISSUER,
      audience: 'another-client',
      expiresIn: 900,
    });

    expect(() => verifyAccessToken(wrong, SECRET)).toThrow(/invalid or has expired/);
  });

  it('rejects a well-signed token that is missing required claims', () => {
    // A token signed with our own secret, so only the claim check can catch it.
    const incomplete = jwt.sign({ sub: '42', role: 'STAFF' }, SECRET, {
      algorithm: 'HS256',
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: 900,
    });

    expect(() => verifyAccessToken(incomplete, SECRET)).toThrow(/missing required claims/);
  });

  it('gives the same message for a forged token as for an expired one', () => {
    // Different messages would let an attacker learn whether a guess was
    // structurally valid.
    let forgedMessage = '';
    let expiredMessage = '';

    try {
      verifyAccessToken('not.a.token', SECRET);
    } catch (error) {
      forgedMessage = (error as AppError).message;
    }

    try {
      verifyAccessToken(signAccessToken(claims, SECRET, 0).accessToken, SECRET);
    } catch (error) {
      expiredMessage = (error as AppError).message;
    }

    expect(forgedMessage).toBe(expiredMessage);
  });

  it('reports 401 for every rejection', () => {
    try {
      verifyAccessToken('garbage', SECRET);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).status).toBe(401);
      expect((error as AppError).code).toBe('UNAUTHORIZED');
    }
  });
});

describe('tokenFromHeader', () => {
  it('extracts a Bearer token', () => {
    expect(tokenFromHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case insensitive about the scheme', () => {
    expect(tokenFromHeader('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns undefined for a missing header', () => {
    expect(tokenFromHeader(undefined)).toBeUndefined();
  });

  it('returns undefined for another scheme', () => {
    expect(tokenFromHeader('Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('returns undefined for an empty value', () => {
    expect(tokenFromHeader('Bearer')).toBeUndefined();
    expect(tokenFromHeader('Bearer   ')).toBeUndefined();
  });
});
