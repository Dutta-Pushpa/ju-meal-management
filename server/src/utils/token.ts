import jwt from 'jsonwebtoken';
import type { Permission, Role } from '@ju/shared';
import { unauthorized } from './errors.js';

/**
 * Access tokens.
 *
 * The scheme is HS256 with a shared secret, which is appropriate for a single
 * service that both issues and verifies its own tokens. If the API is ever
 * split so another service must verify tokens, this needs to become RS256 or
 * ES256 with a public key, because a shared secret means every verifier can
 * also mint tokens.
 */

/** Fixed issuer and audience, checked on every verify. */
export const TOKEN_ISSUER = 'ju-meal-management';
export const TOKEN_AUDIENCE = 'ju-meal-management-client';

export interface AuthTokenClaims {
  /** User id, as a string because JWT subjects are strings by definition. */
  sub: string;
  role: Role;
  permissions: Permission[];
  /**
   * The user's token_version when the token was issued. Compared against the
   * current value to revoke every token that user holds in one step.
   */
  tokenVersion: number;
  /** Session id, so logout can revoke this specific session. */
  sid: string;
  iat: number;
  exp: number;
}

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: Date;
}

export interface SignTokenInput {
  userId: number;
  role: Role;
  permissions: Permission[];
  tokenVersion: number;
  sessionId: string;
}

export function signAccessToken(
  input: SignTokenInput,
  secret: string,
  lifetimeMinutes: number,
): IssuedToken {
  const accessToken = jwt.sign(
    {
      role: input.role,
      permissions: input.permissions,
      tokenVersion: input.tokenVersion,
      sid: input.sessionId,
    },
    secret,
    {
      algorithm: 'HS256',
      subject: String(input.userId),
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: lifetimeMinutes * 60,
      // A unique id per token makes a specific token identifiable in logs.
      jwtid: `${input.sessionId}-${Date.now().toString(36)}`,
    },
  );

  // Decoding is safe here: the token was just signed by us with a known secret.
  const decoded = jwt.decode(accessToken) as { exp: number };

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresAt: new Date(decoded.exp * 1000),
  };
}

/**
 * Verify a token and return its claims.
 *
 * Every rejection looks identical to the caller. A caller must not be able to
 * tell an expired token from a forged one, because that difference tells an
 * attacker whether a guess was structurally valid.
 *
 * @throws {AppError} UNAUTHORIZED
 */
export function verifyAccessToken(token: string, secret: string): AuthTokenClaims {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, secret, {
      // Pinning the algorithm is what stops an attacker presenting a token
      // signed with "none", or with an asymmetric algorithm using the shared
      // secret as the public key.
      algorithms: ['HS256'],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
  } catch {
    throw unauthorized('The access token is invalid or has expired.');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw unauthorized('The access token is invalid or has expired.');
  }

  const claims = decoded as Partial<AuthTokenClaims>;

  if (
    typeof claims.sub !== 'string' ||
    typeof claims.role !== 'string' ||
    typeof claims.tokenVersion !== 'number' ||
    typeof claims.sid !== 'string' ||
    typeof claims.exp !== 'number' ||
    !Array.isArray(claims.permissions)
  ) {
    throw unauthorized('The access token is missing required claims.');
  }

  return claims as AuthTokenClaims;
}

/** Extract the token from an Authorization header, or undefined. */
export function tokenFromHeader(header: string | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }

  const [scheme, value] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
