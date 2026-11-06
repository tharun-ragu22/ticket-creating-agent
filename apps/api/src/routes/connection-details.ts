import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCaller } from '../auth/principal.js';
import { mintConnectionDetails } from '../livekit/token.js';
import type { ApiDeps } from '../app.js';

/**
 * The body LiveKit's TokenSource.endpoint sends.
 *
 * `participant_identity`, `participant_metadata` and `participant_attributes`
 * are declared here only to document that we receive them and throw them away.
 * Parsing then discarding is deliberate: a strict schema would 400 on a stock
 * LiveKit client, and silently ignoring unknown keys would leave the next
 * reader unsure whether they were honoured.
 */
const Body = z
  .object({
    room_name: z.string().min(1).max(200).optional(),
    participant_identity: z.unknown().optional(),
    participant_metadata: z.unknown().optional(),
    participant_attributes: z.unknown().optional(),
    room_config: z.unknown().optional(),
    agent_name: z.unknown().optional(),
  })
  .loose();

export function registerConnectionDetails(app: FastifyInstance, deps: ApiDeps): void {
  app.post('/v1/connection-details', { preHandler: app.authenticate }, async (request) => {
    const { profile } = requireCaller(request.principal);
    const body = Body.parse(request.body ?? {});

    return mintConnectionDetails(deps.config, profile, { roomName: body.room_name });
  });
}
