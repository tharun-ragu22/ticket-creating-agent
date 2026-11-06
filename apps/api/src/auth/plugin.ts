import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { CallerDirectory, IdentityProvider } from '@tca/contracts';
import { CallerNotFoundError } from './directory.js';
import { UnauthenticatedError } from './demo-jwt.js';
import { bearerFrom, isServiceToken, type Principal } from './principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
  interface FastifyInstance {
    /** preHandler that populates `request.principal` or fails with 401. */
    authenticate: preHandlerHookHandler;
  }
}

export interface AuthPluginOptions {
  serviceToken: string;
  identityProvider: IdentityProvider;
  directory: CallerDirectory;
}

/**
 * Resolves a bearer token into a Principal.
 *
 * The service token is checked first and by exact match, so a caller JWT can
 * never be mistaken for the agent. A caller token is then verified *and* the
 * profile loaded: an unknown subject is a 401 rather than a 200 with an empty
 * profile, because a ticket filed against a subject that has no directory
 * entry has no reporter anyone can contact.
 */
export function registerAuth(app: FastifyInstance, options: AuthPluginOptions): void {
  app.decorateRequest('principal');

  app.decorate('authenticate', async function authenticate(request: FastifyRequest) {
    const token = bearerFrom(request);
    if (!token) {
      throw new UnauthenticatedError('Missing or malformed Authorization: Bearer header');
    }

    if (isServiceToken(token, options.serviceToken)) {
      request.principal = { kind: 'service', name: 'agent' };
      return;
    }

    const identity = await options.identityProvider.verify(token);

    try {
      request.principal = {
        kind: 'caller',
        identity,
        profile: await options.directory.lookup(identity),
      };
    } catch (cause) {
      if (cause instanceof CallerNotFoundError) {
        throw new UnauthenticatedError(cause.message);
      }
      throw cause;
    }
  } as preHandlerHookHandler);
}
