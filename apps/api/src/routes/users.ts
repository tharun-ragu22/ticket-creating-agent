import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../auth/principal.js';
import type { ApiDeps } from '../app.js';

export function registerUserRoutes(app: FastifyInstance, deps: ApiDeps): void {
  /**
   * How the agent learns who it is talking to.
   *
   * The agent holds only the `caller.subject` participant attribute, never a
   * token belonging to the caller, so the lookup is subject-keyed and
   * authenticated with the service token. Everything that makes the never-ask
   * rule possible — name, department, asset tags, open tickets — is served
   * here, which is also why a caller may read only their own entry.
   */
  app.get<{ Params: { subject: string } }>(
    '/v1/users/:subject',
    { preHandler: app.authenticate },
    async (request) => {
      const principal = request.principal;
      const { subject } = request.params;

      if (principal.kind === 'caller' && principal.identity.subject !== subject) {
        throw new ForbiddenError('A caller may only read their own profile');
      }

      return deps.directory.lookupBySubject(subject);
    },
  );
}
