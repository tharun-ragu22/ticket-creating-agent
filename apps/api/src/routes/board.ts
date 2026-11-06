import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { ProviderCallContext } from '@tca/contracts';
import type { ApiDeps } from '../app.js';

const PAGE = join(dirname(fileURLToPath(import.meta.url)), '../../public/board.html');

const BOARD_CTX: ProviderCallContext = {
  actor: { subject: 'board', email: '', displayName: 'Demo board' },
  requestId: 'board',
};

/**
 * The demo ticket board.
 *
 * Disposable scaffolding: it is the observation window for every later phase,
 * not a product surface — Synergy Interact has its own UI. Deliberately not
 * built here: auth, editing, assignment, filters, real-time push.
 *
 * Its read endpoints are unauthenticated, which is only tolerable because the
 * whole group is registered solely under the demo providers. Pointing
 * TICKET_PROVIDER at Interact or IDENTITY_PROVIDER at oidc removes these
 * routes, rather than leaving an open ticket list one config flag away from
 * production.
 */
export function registerBoard(app: FastifyInstance, deps: ApiDeps): void {
  if (deps.config.identityProvider !== 'demo-jwt' || deps.config.ticketProvider !== 'demo') {
    return;
  }

  app.get('/board', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(await readFile(PAGE, 'utf8'));
  });

  app.get('/v1/board/tickets', async () => {
    // No reporterSubject filter: this is an operator view of every call.
    return deps.ticketProvider.listTickets({ limit: 100 }, BOARD_CTX);
  });

  app.get<{ Params: { id: string } }>('/v1/board/transcripts/:id', async (request, reply) => {
    const stored = await deps.transcripts.get(request.params.id);
    return stored ? stored : reply.code(404).send({ error: 'not_found' });
  });
}
