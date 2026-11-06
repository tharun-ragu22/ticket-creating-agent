import type { FastifyInstance } from 'fastify';
import { requireService, type Principal } from '../auth/principal.js';
import { CreateTranscriptInput } from '../db/transcripts.js';
import type { ApiDeps } from '../app.js';

export function registerTranscriptRoutes(app: FastifyInstance, deps: ApiDeps): void {
  /**
   * Service-only.
   *
   * The transcript is the evidence of what was said on the call. A caller who
   * could write one could rewrite the record of their own conversation, so
   * only the agent records it.
   */
  app.post('/v1/transcripts', { preHandler: app.authenticate }, async (request, reply) => {
    requireService(request.principal);

    const input = CreateTranscriptInput.parse(request.body);
    const stored = await deps.transcripts.create(input);

    // Shaped as a TranscriptRef so it drops straight onto CreateTicketInput.
    return reply.code(201).send({
      id: stored.id,
      uri: `${deps.config.publicBaseUrl}/v1/transcripts/${stored.id}`,
    });
  });

  app.get<{ Params: { id: string } }>(
    '/v1/transcripts/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const stored = await deps.transcripts.get(request.params.id);

      // 404 rather than 403 on someone else's call, for the same reason as
      // tickets: a 403 confirms the id exists.
      if (!stored || !mayRead(request.principal, stored.callerSubject)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return stored;
    },
  );
}

const mayRead = (principal: Principal, callerSubject: string): boolean =>
  principal.kind === 'service' || principal.identity.subject === callerSubject;
