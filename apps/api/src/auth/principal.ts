import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { CallerIdentity, CallerProfile } from '@tca/contracts';

/**
 * Who is making a request.
 *
 * Two kinds, deliberately not interchangeable. A `caller` is a human holding
 * an app token and may only ever act as themselves. A `service` is the agent
 * worker, which has no identity of its own and must name the subject it is
 * acting for — see resolveReporter in routes/tickets.ts.
 */
export type Principal =
  | { kind: 'caller'; identity: CallerIdentity; profile: CallerProfile }
  | { kind: 'service'; name: 'agent' };

export class ForbiddenError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ForbiddenError';
  }
}

export function bearerFrom(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/** Constant-time comparison, so the service token cannot be guessed byte by byte. */
export function isServiceToken(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireCaller(principal: Principal): Extract<Principal, { kind: 'caller' }> {
  if (principal.kind !== 'caller') {
    throw new ForbiddenError('This endpoint requires a signed-in caller, not a service token');
  }
  return principal;
}

export function requireService(principal: Principal): void {
  if (principal.kind !== 'service') {
    throw new ForbiddenError('This endpoint requires the agent service token');
  }
}
