import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CallSource,
  CreateTicketInput,
  ProposeTicketToolInput,
  ReporterRef,
  Ticket,
  TicketStatus,
  TranscriptRef,
  type CallerProfile,
  type ProviderCallContext,
  type TicketQuery,
} from '@tca/contracts';
import type { Principal } from '../auth/principal.js';
import { BadRequestError } from '../errors.js';
import type { ApiDeps } from '../app.js';

/**
 * The create body.
 *
 * `reporter` and `reporterSubject` are both declared but neither is trusted
 * blindly — see resolveReporter. A caller's own subject always wins over
 * anything in the body.
 */
const CreateBody = ProposeTicketToolInput.extend({
  source: CallSource,
  transcriptRef: TranscriptRef.nullable().default(null),
  tags: z.array(z.string()).default([]),
  providerExtras: z.record(z.string(), z.unknown()).default({}),
  /** Fallback when no Idempotency-Key header is sent. */
  idempotencyKey: z.string().min(16).optional(),
  reporter: ReporterRef.optional(),
  reporterSubject: z.string().min(1).optional(),
});

const ListQuery = z.object({
  reporterSubject: z.string().min(1).optional(),
  status: z
    .union([TicketStatus, z.array(TicketStatus)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

const CommentBody = z.object({ body: z.string().min(1).max(4000) });

export function registerTicketRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post('/v1/tickets', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = CreateBody.parse(request.body);
    const idempotencyKey = idempotencyKeyFor(request, parsed.idempotencyKey);
    const ctx = contextFor(request);

    const input = CreateTicketInput.parse({
      title: parsed.title,
      description: parsed.description,
      category: parsed.category,
      priority: parsed.priority,
      affectedAsset: parsed.affectedAsset,
      impact: parsed.impact,
      troubleshootingTried: parsed.troubleshootingTried,
      source: parsed.source,
      transcriptRef: parsed.transcriptRef,
      tags: parsed.tags,
      providerExtras: parsed.providerExtras,
      idempotencyKey,
      reporter: await resolveReporter(request.principal, parsed, deps),
    });

    // A replay is a 200, never a 409. The LLM reads a 4xx as a failure,
    // apologises and tries again, which is exactly how one call becomes three
    // tickets.
    const existing = await deps.ticketProvider.findByIdempotencyKey(idempotencyKey, ctx);
    if (existing) {
      return reply.code(200).send(existing);
    }

    const created = await deps.ticketProvider.createTicket(input, ctx);
    return reply.code(201).send(created);
  });

  app.get('/v1/tickets', { preHandler: app.authenticate }, async (request) => {
    const q = ListQuery.parse(request.query);
    const scoped = scopeSubject(request.principal, q.reporterSubject);

    const query: TicketQuery = {
      ...(scoped !== undefined ? { reporterSubject: scoped } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.q !== undefined ? { q: q.q } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
    };

    return deps.ticketProvider.listTickets(query, contextFor(request));
  });

  app.get<{ Params: { id: string } }>(
    '/v1/tickets/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const ticket = await readableTicket(request, deps);
      return ticket ? ticket : reply.code(404).send({ error: 'not_found' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/tickets/:id/comments',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { body } = CommentBody.parse(request.body);
      const ticket = await readableTicket(request, deps);
      if (!ticket) return reply.code(404).send({ error: 'not_found' });

      await deps.ticketProvider.addComment(ticket.id, body, contextFor(request));
      return reply.code(201).send({ ok: true });
    },
  );

  app.get('/v1/ticket-schema', { preHandler: app.authenticate }, async (request) => {
    return deps.ticketProvider.describeSchema(contextFor(request));
  });
}

/**
 * Who the ticket is filed against.
 *
 * The three cases are deliberately asymmetric:
 *
 *  - A **caller** always files as themselves. Anything in the body is
 *    discarded, so a compromised app cannot file against a colleague.
 *  - The **service** (the agent worker) names a subject and the reporter is
 *    resolved from the directory, so even the agent cannot invent a reporter's
 *    email or department.
 *  - The service may also pass a complete `reporter`. That path exists so
 *    TicketApiClient can satisfy the TicketProvider contract, which requires a
 *    reporter to round-trip verbatim; it is reachable only with the service
 *    token.
 */
async function resolveReporter(
  principal: Principal,
  body: z.infer<typeof CreateBody>,
  deps: ApiDeps,
): Promise<ReporterRef> {
  if (principal.kind === 'caller') {
    return reporterFromProfile(principal.profile);
  }

  if (body.reporter) return body.reporter;

  if (!body.reporterSubject) {
    throw new BadRequestError(
      'A service-token request must name the caller: send `reporterSubject` or a full `reporter`.',
    );
  }
  return reporterFromProfile(await deps.directory.lookupBySubject(body.reporterSubject));
}

function reporterFromProfile(profile: CallerProfile): ReporterRef {
  return {
    subject: profile.subject,
    displayName: profile.displayName,
    email: profile.email,
    department: profile.department,
    jobTitle: profile.jobTitle,
    location: profile.location,
    phone: profile.phone,
  };
}

/** Header wins: it is the transport-level key a retrying HTTP client resends. */
function idempotencyKeyFor(request: FastifyRequest, fromBody: string | undefined): string {
  const header = request.headers['idempotency-key'];
  const value = (Array.isArray(header) ? header[0] : header)?.trim() || fromBody;

  if (!value || value.length < 16) {
    throw new BadRequestError(
      'An Idempotency-Key header of at least 16 characters is required. ' +
        'Without one, a network retry files a second ticket for the same call.',
    );
  }
  return value;
}

/**
 * A caller may only ever list their own tickets, whatever they ask for.
 * Tickets carry the reporter's phone number and whatever they said on the
 * call, so this is a confidentiality boundary, not a convenience.
 */
function scopeSubject(principal: Principal, requested: string | undefined): string | undefined {
  return principal.kind === 'caller' ? principal.identity.subject : requested;
}

/**
 * Fetches a ticket the principal is allowed to see.
 *
 * Returns null — and so a 404 — rather than a 403 for someone else's ticket.
 * A 403 confirms the id exists, which is itself a disclosure.
 */
async function readableTicket(
  request: FastifyRequest<{ Params: { id: string } }>,
  deps: ApiDeps,
): Promise<Ticket | null> {
  const ticket = await deps.ticketProvider.getTicket(request.params.id, contextFor(request));
  if (!ticket) return null;

  const principal = request.principal;
  if (principal.kind === 'caller' && ticket.reporter.subject !== principal.identity.subject) {
    return null;
  }
  return ticket;
}

function contextFor(request: FastifyRequest): ProviderCallContext {
  const principal = request.principal;

  return {
    actor:
      principal.kind === 'caller'
        ? {
            subject: principal.identity.subject,
            email: principal.identity.email,
            displayName: principal.profile.displayName,
          }
        : { subject: 'agent', email: '', displayName: 'Voice ticketing agent' },
    requestId: String(request.id),
  };
}
