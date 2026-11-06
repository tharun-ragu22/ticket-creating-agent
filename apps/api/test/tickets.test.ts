import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeCreateTicketInput, DAVE } from '@tca/test-helpers';
import { buildTestApi, bearer, type TestApi } from './helpers.js';

/** A request body as the agent sends it: a draft, plus the call it came from. */
function body(over: Record<string, unknown> = {}) {
  const input = makeCreateTicketInput();
  return {
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    affectedAsset: input.affectedAsset,
    impact: input.impact,
    troubleshootingTried: input.troubleshootingTried,
    source: input.source,
    ...over,
  };
}

describe('POST /v1/tickets as a caller', () => {
  let api: TestApi;
  let token: string;
  beforeAll(async () => {
    api = await buildTestApi();
    token = await api.callerToken('priya');
  });
  afterAll(async () => { await api?.close(); });

  it('creates a ticket and returns 201', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'caller-create-0000000001' },
      payload: body(),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().providerTicketId).toMatch(/^SI-/);
  });

  /**
   * The headline requirement, enforced at the layer that actually writes.
   * Even if the agent were fully compromised, a caller token can only ever
   * file against its own subject.
   */
  it('files the ticket against the authenticated caller, ignoring any reporter in the body', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'caller-spoof-00000000001' },
      payload: body({ reporter: DAVE, reporterSubject: 'dave' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().reporter).toMatchObject({
      subject: 'priya',
      displayName: 'Priya Raman',
      email: 'priya.raman@synergyit.example',
    });
  });

  it('fills reporter contact details from the directory, not from the request', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'caller-directory-000001' },
      payload: body(),
    });

    expect(res.json().reporter).toMatchObject({
      department: 'Finance',
      jobTitle: 'AP Specialist',
      location: 'Toronto HQ, 4th floor',
    });
  });

  it('400s without an idempotency key, because a retry would otherwise double-file', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: bearer(token),
      payload: body(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s on a draft that fails the contract, rather than storing junk', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'caller-invalid-0000001' },
      payload: body({ title: 'short' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('401s without a token', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { 'idempotency-key': 'caller-noauth-00000001' },
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * Layer 3 of the duplicate-ticket defence. A 409 is specifically wrong here:
 * the LLM reads an error, apologises and retries, which is how one call
 * becomes three tickets.
 */
describe('POST /v1/tickets idempotency', () => {
  let api: TestApi;
  let token: string;
  beforeAll(async () => {
    api = await buildTestApi();
    token = await api.callerToken('priya');
  });
  afterAll(async () => { await api?.close(); });

  const post = (key: string, payload: Record<string, unknown>) =>
    api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload,
    });

  it('returns 200 and the existing ticket on a repeated key, never 409', async () => {
    const payload = body();
    const first = await post('replay-key-000000000001', payload);
    const second = await post('replay-key-000000000001', payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().providerTicketId).toBe(first.json().providerTicketId);
  });

  it('does not create a second ticket on a repeated key', async () => {
    const payload = body();
    await post('replay-count-0000000001', payload);
    await post('replay-count-0000000001', payload);

    const list = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets?limit=100',
      headers: bearer(token),
    });
    const matching = list
      .json()
      .items.filter((t: { title: string }) => t.title === payload.title);
    expect(matching).toHaveLength(1);
  });

  it('ignores a changed payload when the key repeats, so a retry cannot rewrite a ticket', async () => {
    const first = await post('replay-rewrite-000000001', body());
    const second = await post(
      'replay-rewrite-000000001',
      body({ title: 'Something else entirely for the same key', priority: 'low' }),
    );

    expect(second.json().title).toBe(first.json().title);
    expect(second.json().priority).toBe(first.json().priority);
  });

  it('accepts an idempotency key from the body when no header is sent', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: bearer(token),
      payload: body({ idempotencyKey: 'body-key-00000000000001' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('lets the header win over the body, since the transport-level key is the authoritative one', async () => {
    const payload = body({ idempotencyKey: 'ignored-body-key-000001' });
    const first = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'header-wins-00000000001' },
      payload,
    });
    const second = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(token), 'idempotency-key': 'header-wins-00000000001' },
      payload: { ...payload, idempotencyKey: 'a-different-body-key-01' },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });
});

describe('POST /v1/tickets as the agent service', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('files against the named subject, resolving the reporter from the directory', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(api.serviceToken), 'idempotency-key': 'svc-create-000000000001' },
      payload: body({ reporterSubject: 'dave' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().reporter).toMatchObject({
      subject: 'dave',
      displayName: 'Dave Okonjo',
      department: 'Legal',
    });
  });

  it('400s when the service names no subject: it has no identity of its own to fall back on', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(api.serviceToken), 'idempotency-key': 'svc-nosubject-00000001' },
      payload: body(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s on a subject with no directory entry', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(api.serviceToken), 'idempotency-key': 'svc-ghost-0000000000001' },
      payload: body({ reporterSubject: 'nobody' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('honours a reporter passed verbatim, which is how TicketApiClient satisfies the provider contract', async () => {
    const reporter = { ...DAVE, subject: 'verbatim-reporter' };
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(api.serviceToken), 'idempotency-key': 'svc-verbatim-000000001' },
      payload: body({ reporter }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().reporter).toEqual(reporter);
  });
});

describe('GET /v1/tickets', () => {
  let api: TestApi;
  let priya: string;
  beforeAll(async () => {
    api = await buildTestApi();
    priya = await api.callerToken('priya');

    for (const [i, subject] of ['priya', 'priya', 'dave'].entries()) {
      await api.app.inject({
        method: 'POST',
        url: '/v1/tickets',
        headers: {
          ...bearer(api.serviceToken),
          'idempotency-key': `list-seed-${i}-00000000`,
        },
        payload: body({ reporterSubject: subject }),
      });
    }
  });
  afterAll(async () => { await api?.close(); });

  /** Tickets contain the reporter's phone number and whatever they said on the call. */
  it('scopes a caller to their own tickets even when they ask for someone elses', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets?reporterSubject=dave',
      headers: bearer(priya),
    });

    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t: { reporter: { subject: string } }) => t.reporter.subject === 'priya'))
      .toBe(true);
  });

  it('lets the service read any subject', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets?reporterSubject=dave',
      headers: bearer(api.serviceToken),
    });

    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].reporter.subject).toBe('dave');
  });

  it('paginates with a cursor', async () => {
    const first = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets?limit=1',
      headers: bearer(priya),
    });
    expect(first.json().items).toHaveLength(1);
    expect(first.json().nextCursor).toBeTruthy();

    const second = await api.app.inject({
      method: 'GET',
      url: `/v1/tickets?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: bearer(priya),
    });
    expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
  });

  it('filters by status', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets?status=closed',
      headers: bearer(priya),
    });
    expect(res.json().items).toHaveLength(0);
  });

  it('401s without a token', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/v1/tickets' })).statusCode).toBe(401);
  });
});

describe('GET /v1/tickets/:id', () => {
  let api: TestApi;
  let priya: string;
  let daveTicketId: string;
  let priyaTicketId: string;

  beforeAll(async () => {
    api = await buildTestApi();
    priya = await api.callerToken('priya');

    const mk = async (subject: string, key: string) => {
      const res = await api.app.inject({
        method: 'POST',
        url: '/v1/tickets',
        headers: { ...bearer(api.serviceToken), 'idempotency-key': key },
        payload: body({ reporterSubject: subject }),
      });
      return res.json().id as string;
    };

    priyaTicketId = await mk('priya', 'get-priya-000000000001');
    daveTicketId = await mk('dave', 'get-dave-0000000000001');
  });
  afterAll(async () => { await api?.close(); });

  it('returns the caller own ticket', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/tickets/${priyaTicketId}`,
      headers: bearer(priya),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(priyaTicketId);
  });

  /** 404 rather than 403: a 403 confirms the ticket exists, which is itself a leak. */
  it('404s on another callers ticket', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/tickets/${daveTicketId}`,
      headers: bearer(priya),
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s on an unknown id', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/tickets/no-such-ticket',
      headers: bearer(priya),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/tickets/:id/comments', () => {
  let api: TestApi;
  let priya: string;
  let ticketId: string;

  beforeAll(async () => {
    api = await buildTestApi();
    priya = await api.callerToken('priya');
    const created = await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(priya), 'idempotency-key': 'comment-seed-000000001' },
      payload: body(),
    });
    ticketId = created.json().id;
  });
  afterAll(async () => { await api?.close(); });

  it('appends a comment, so a repeat report can append instead of filing again', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/comments`,
      headers: bearer(priya),
      payload: { body: 'Caller rang back; still happening after a reboot.' },
    });
    expect(res.statusCode).toBe(201);

    const fetched = await api.app.inject({
      method: 'GET',
      url: `/v1/tickets/${ticketId}`,
      headers: bearer(priya),
    });
    expect(fetched.json().comments.map((c: { body: string }) => c.body)).toContain(
      'Caller rang back; still happening after a reboot.',
    );
  });

  it('400s on an empty comment', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/comments`,
      headers: bearer(priya),
      payload: { body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s on another callers ticket', async () => {
    const dave = await api.callerToken('dave');
    const res = await api.app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/comments`,
      headers: bearer(dave),
      payload: { body: 'Should not be able to reach this ticket.' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/ticket-schema', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  /** The agent injects this into the prompt, so Interact's real taxonomy
   *  works without a prompt rewrite. */
  it('serves the live provider taxonomy to the service', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/ticket-schema',
      headers: bearer(api.serviceToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().categories.length).toBeGreaterThan(0);
    expect(res.json().priorities.length).toBeGreaterThan(0);
  });

  it('401s without a token', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/v1/ticket-schema' })).statusCode)
      .toBe(401);
  });
});
