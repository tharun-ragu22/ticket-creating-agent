import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApi, bearer, type TestApi } from './helpers.js';

const TURNS = [
  { role: 'agent', text: 'Hi Priya, what is going on?', at: '2026-11-05T09:00:01.000Z' },
  { role: 'caller', text: 'Outlook will not open.', at: '2026-11-05T09:00:06.000Z' },
];

const payload = (over: Record<string, unknown> = {}) => ({
  roomName: 'call-priya-abcd1234',
  sessionId: 'sess_1',
  callerSubject: 'priya',
  turns: TURNS,
  ...over,
});

describe('POST /v1/transcripts', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('stores a transcript and returns a TranscriptRef the ticket can carry', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: bearer(api.serviceToken),
      payload: payload(),
    });

    expect(res.statusCode).toBe(201);
    const ref = res.json();
    expect(ref.id).toMatch(/^tr_/);
    expect(ref.uri).toContain(ref.id);
  });

  /**
   * The transcript is the evidence of what was said. A caller who could write
   * one could rewrite the record of their own call, so the agent is the only
   * principal allowed to create them.
   */
  it('403s a caller token: only the agent records what was said', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: bearer(await api.callerToken('priya')),
      payload: payload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('401s without a token', async () => {
    const res = await api.app.inject({ method: 'POST', url: '/v1/transcripts', payload: payload() });
    expect(res.statusCode).toBe(401);
  });

  it('400s on an empty turn list', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: bearer(api.serviceToken),
      payload: payload({ turns: [] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s on an unknown speaker role', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: bearer(api.serviceToken),
      payload: payload({ turns: [{ role: 'system', text: 'x', at: '2026-11-05T09:00:01.000Z' }] }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/transcripts/:id', () => {
  let api: TestApi;
  let id: string;
  beforeAll(async () => {
    api = await buildTestApi();
    const created = await api.app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: bearer(api.serviceToken),
      payload: payload(),
    });
    id = created.json().id;
  });
  afterAll(async () => { await api?.close(); });

  it('returns the turns in order', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/transcripts/${id}`,
      headers: bearer(api.serviceToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().turns.map((t: { role: string }) => t.role)).toEqual(['agent', 'caller']);
  });

  it('lets the caller read their own call', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/transcripts/${id}`,
      headers: bearer(await api.callerToken('priya')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('404s another callers transcript', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/transcripts/${id}`,
      headers: bearer(await api.callerToken('dave')),
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s an unknown id', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/transcripts/tr_nope',
      headers: bearer(api.serviceToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/users/:subject', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  /**
   * This is how the agent learns who it is talking to. It holds only the
   * `caller.subject` participant attribute, never a token belonging to the
   * caller, so the lookup has to be subject-keyed and service-authenticated.
   */
  it('serves the full profile to the agent, which is what makes the never-ask rule possible', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/users/priya',
      headers: bearer(api.serviceToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      subject: 'priya',
      displayName: 'Priya Raman',
      department: 'Finance',
      location: 'Toronto HQ, 4th floor',
    });
    expect(res.json().knownAssets).toEqual([
      { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
      { kind: 'mobile', label: 'iPhone 15', identifier: 'SYN-MO-0442' },
    ]);
  });

  it('includes open tickets, which is what lets the agent offer a comment instead of a duplicate', async () => {
    await api.app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(api.serviceToken), 'idempotency-key': 'profile-open-0000000001' },
      payload: {
        title: 'VPN drops on hotel wifi repeatedly',
        description: 'The VPN client disconnects every few minutes on hotel wifi while travelling.',
        category: 'network',
        priority: 'normal',
        affectedAsset: null,
        impact: { scope: 'self', usersAffected: 1, workBlocked: false },
        troubleshootingTried: [],
        source: {
          channel: 'voice',
          sessionId: 'sess_open',
          roomName: 'room_open',
          startedAt: '2026-11-05T09:00:00.000Z',
        },
        reporterSubject: 'priya',
      },
    });

    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/users/priya',
      headers: bearer(api.serviceToken),
    });

    expect(res.json().openTickets).toHaveLength(1);
    expect(res.json().openTickets[0]).toMatchObject({
      title: 'VPN drops on hotel wifi repeatedly',
      status: 'new',
    });
  });

  it('lets a caller read their own profile', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/users/priya',
      headers: bearer(await api.callerToken('priya')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('403s a caller reading somebody elses profile: this endpoint serves phone numbers and asset tags', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/users/dave',
      headers: bearer(await api.callerToken('priya')),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s an unknown subject', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/users/nobody',
      headers: bearer(api.serviceToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('401s without a token', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/v1/users/priya' })).statusCode).toBe(401);
  });
});
