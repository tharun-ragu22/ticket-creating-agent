import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCaller } from '../auth/principal.js';
import { DEMO_TOKEN_TTL_SECONDS, signDemoToken } from '../auth/demo-jwt.js';
import { CallerNotFoundError } from '../auth/directory.js';
import type { ApiDeps } from '../app.js';

const LoginBody = z.object({ subject: z.string().min(1) });

export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/v1/me', { preHandler: app.authenticate }, async (request) => {
    return requireCaller(request.principal).profile;
  });

  // The demo login hands out a token to anyone who names a subject. It is
  // registered only under IDENTITY_PROVIDER=demo-jwt, so configuring a real
  // identity provider removes the route rather than merely discouraging it.
  if (deps.config.identityProvider !== 'demo-jwt') return;

  app.get('/v1/auth/demo-users', async () => {
    return { items: await deps.directory.list() };
  });

  app.post('/v1/auth/demo-login', async (request, reply) => {
    const { subject } = LoginBody.parse(request.body);

    let profile;
    try {
      profile = await deps.directory.lookupBySubject(subject);
    } catch (cause) {
      if (cause instanceof CallerNotFoundError) {
        return reply.code(404).send({ error: 'not_found', detail: cause.message });
      }
      throw cause;
    }

    return {
      access_token: await signDemoToken(deps.config.demoJwtSecret, { subject }),
      token_type: 'Bearer',
      expires_in: DEMO_TOKEN_TTL_SECONDS,
      profile,
    };
  });
}
