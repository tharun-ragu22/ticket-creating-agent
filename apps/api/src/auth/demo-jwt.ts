import { SignJWT, jwtVerify } from 'jose';
import { CallerIdentity, type IdentityProvider } from '@tca/contracts';
import { DEMO_USERS } from '../db/seed.js';

const ISSUER = 'tca-demo';
const AUDIENCE = 'tca-api';
const DEFAULT_TTL_SECONDS = 60 * 60 * 8;

export class UnauthenticatedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * The demo app token.
 *
 * HS256 with a shared secret, which is only acceptable because the API is the
 * sole issuer and the sole verifier. Swapping to Okta or Entra replaces this
 * class with a `jose` createRemoteJWKSet verifier behind the same
 * IdentityProvider interface — no call site changes.
 */
export class DemoJwtIdentityProvider implements IdentityProvider {
  readonly name = 'demo-jwt';
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(bearerToken: string): Promise<CallerIdentity> {
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(bearerToken, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }));
    } catch (cause) {
      throw new UnauthenticatedError(
        cause instanceof Error ? cause.message : 'token verification failed',
      );
    }

    const parsed = CallerIdentity.safeParse({
      subject: claims.sub,
      email: claims['email'],
      tenantId: claims['tenant_id'],
      scopes: claims['scopes'] ?? [],
    });

    if (!parsed.success) {
      throw new UnauthenticatedError('token is missing required identity claims');
    }
    return parsed.data;
  }
}

export interface SignDemoTokenOptions {
  subject: string;
  ttlSeconds?: number;
}

/**
 * Mints a demo app token. Only reachable from POST /v1/auth/demo-login and the
 * test suite; a real deployment never calls it.
 */
export async function signDemoToken(
  secret: string,
  options: SignDemoTokenOptions,
): Promise<string> {
  const user = DEMO_USERS.find((u) => u.subject === options.subject);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return new SignJWT({
    email: user?.email ?? `${options.subject}@synergyit.example`,
    tenant_id: user?.tenantId ?? 'synergy-it',
    scopes: user?.scopes ?? ['tickets:create', 'tickets:read'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(options.subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttl)
    .sign(new TextEncoder().encode(secret));
}

export const DEMO_TOKEN_TTL_SECONDS = DEFAULT_TTL_SECONDS;
