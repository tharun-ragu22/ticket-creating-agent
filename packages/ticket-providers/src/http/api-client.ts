import {
  Ticket,
  type CreateTicketInput,
  type Page,
  type ProviderCallContext,
  type TicketProvider,
  type TicketQuery,
  type TicketSchemaDescriptor,
} from '@tca/contracts';

export interface TicketApiClientOptions {
  /** Base URL of the ticket API, e.g. http://127.0.0.1:8080 */
  baseUrl: string;
  /** The agent's service token. Not a caller token — see routes/tickets.ts. */
  serviceToken: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class TicketApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`${method} ${path} failed with ${status}: ${detail}`);
    this.name = 'TicketApiError';
  }
}

/**
 * Generous for the same reason as AgentApiClient's: describeSchema runs
 * immediately after the profile lookup when a call starts, so a slow answer
 * here also ends the call before the caller hears anything.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The TicketProvider the agent actually uses.
 *
 * The agent talks HTTP to our API rather than importing DemoTicketProvider
 * directly, which buys three things: the agent never holds ticketing-system
 * credentials, swapping Demo for Interact is an API-side env change with no
 * agent redeploy, and there is exactly one idempotency_key ledger instead of
 * one per worker.
 *
 * It still implements TicketProvider, so the seam the agent programs against
 * is identical either way — and it is held to the same contract suite. See
 * apps/api/test/api-client.contract.test.ts.
 */
export class TicketApiClient implements TicketProvider {
  /**
   * Named for the transport, not the backing store. The agent logs this; if it
   * said 'demo' there would be no way to tell from a log that a hop was
   * involved once the store behind the API is swapped.
   */
  readonly name = 'ticket-api';

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: TicketApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createTicket(input: CreateTicketInput, ctx: ProviderCallContext): Promise<Ticket> {
    const { idempotencyKey, ...draft } = input;

    const response = await this.request('POST', '/v1/tickets', ctx, {
      body: draft,
      // Transport-level, so an HTTP retry resends the same key. The API
      // answers a repeat with 200 and the existing ticket, never a 409.
      headers: { 'idempotency-key': idempotencyKey },
      // 200 is a replay of this exact call, which is a success, not a conflict.
      okStatuses: [200, 201],
    });

    return Ticket.parse(await response.json());
  }

  getTicket(id: string, ctx: ProviderCallContext): Promise<Ticket | null> {
    return this.maybeTicket('GET', `/v1/tickets/${encodeURIComponent(id)}`, ctx);
  }

  findByIdempotencyKey(key: string, ctx: ProviderCallContext): Promise<Ticket | null> {
    return this.maybeTicket(
      'GET',
      `/v1/tickets/by-idempotency-key/${encodeURIComponent(key)}`,
      ctx,
    );
  }

  async listTickets(query: TicketQuery, ctx: ProviderCallContext): Promise<Page<Ticket>> {
    const params = new URLSearchParams();
    if (query.reporterSubject) params.set('reporterSubject', query.reporterSubject);
    if (query.q) params.set('q', query.q);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    for (const status of query.status ?? []) params.append('status', status);

    const search = params.size > 0 ? `?${params.toString()}` : '';
    const response = await this.request('GET', `/v1/tickets${search}`, ctx);
    const page = (await response.json()) as { items: unknown[]; nextCursor: string | null };

    return {
      items: page.items.map((item) => Ticket.parse(item)),
      nextCursor: page.nextCursor,
    };
  }

  async addComment(id: string, body: string, ctx: ProviderCallContext): Promise<void> {
    await this.request('POST', `/v1/tickets/${encodeURIComponent(id)}/comments`, ctx, {
      body: { body },
      okStatuses: [201],
    });
  }

  async describeSchema(ctx: ProviderCallContext): Promise<TicketSchemaDescriptor> {
    const response = await this.request('GET', '/v1/ticket-schema', ctx);
    return (await response.json()) as TicketSchemaDescriptor;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return { ok: false, detail: `/healthz returned ${response.status}` };
      }
      return { ok: true };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : 'unreachable' };
    }
  }

  /** A 404 is a legitimate answer for the two lookup methods, not a failure. */
  private async maybeTicket(
    method: string,
    path: string,
    ctx: ProviderCallContext,
  ): Promise<Ticket | null> {
    const response = await this.request(method, path, ctx, { okStatuses: [200, 404] });
    return response.status === 404 ? null : Ticket.parse(await response.json());
  }

  private async request(
    method: string,
    path: string,
    ctx: ProviderCallContext,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      okStatuses?: number[];
    } = {},
  ): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.serviceToken}`,
        // Carries the agent's request id through, so one call can be traced
        // across both processes in a log search.
        'x-request-id': ctx.requestId,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: ctx.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    const allowed = options.okStatuses ?? [200];
    if (!allowed.includes(response.status)) {
      throw new TicketApiError(response.status, method, path, await detailOf(response));
    }
    return response;
  }
}

async function detailOf(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500) || response.statusText;
  } catch {
    return response.statusText;
  }
}
