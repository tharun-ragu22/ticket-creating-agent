import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  NotImplementedError,
  type IdentityProvider,
  type TicketProvider,
  type TranscriptStore,
} from '@tca/contracts';
import type { ApiConfig } from './config.js';
import { UnauthenticatedError } from './auth/demo-jwt.js';
import { CallerNotFoundError, type ApiCallerDirectory } from './auth/directory.js';
import { ForbiddenError } from './auth/principal.js';
import { BadRequestError } from './errors.js';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerConnectionDetails } from './routes/connection-details.js';
import { registerTicketRoutes } from './routes/tickets.js';
import { registerTranscriptRoutes } from './routes/transcripts.js';
import { registerUserRoutes } from './routes/users.js';
import { registerBoard } from './routes/board.js';

export interface ApiDeps {
  config: ApiConfig;
  ticketProvider: TicketProvider;
  identityProvider: IdentityProvider;
  directory: ApiCallerDirectory;
  transcripts: TranscriptStore;
}

export async function buildApp(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.logLevel === 'silent' ? false : { level: deps.config.logLevel },
    // The board polls /v1/tickets; a request id per call keeps the provider
    // call context traceable without a correlation header from the client.
    genReqId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof UnauthenticatedError) {
      return reply.code(401).send({ error: 'unauthenticated', detail: error.message });
    }
    if (error instanceof ForbiddenError) {
      return reply.code(403).send({ error: 'forbidden', detail: error.message });
    }
    if (error instanceof CallerNotFoundError) {
      return reply.code(404).send({ error: 'not_found', detail: error.message });
    }
    if (error instanceof BadRequestError) {
      return reply.code(400).send({ error: 'bad_request', detail: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', issues: error.issues });
    }
    if (error instanceof NotImplementedError) {
      return reply.code(501).send({ error: 'not_implemented', detail: error.message });
    }
    // Fastify's own schema validation failures, as distinct from the ZodError
    // our handlers throw.
    if (error.validation) {
      return reply.code(400).send({ error: 'bad_request', detail: error.message });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', detail: 'Unexpected error' });
  });

  registerAuth(app, {
    serviceToken: deps.config.serviceToken,
    identityProvider: deps.identityProvider,
    directory: deps.directory,
  });

  app.get('/healthz', async () => ({
    ok: true,
    ticketProvider: deps.ticketProvider.name,
    identityProvider: deps.identityProvider.name,
    provider: await deps.ticketProvider.healthCheck(),
  }));

  registerAuthRoutes(app, deps);
  registerConnectionDetails(app, deps);
  registerTicketRoutes(app, deps);
  registerTranscriptRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerBoard(app, deps);

  return app;
}
