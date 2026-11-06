import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { decodeJwt } from 'jose';
import { signDemoToken } from '../src/auth/demo-jwt.js';
import { buildTestApi, bearer, TEST_CONFIG, type TestApi } from './helpers.js';

/**
 * POST /v1/connection-details is the trust boundary of the whole product.
 *
 * The LiveKit client's `TokenSource.endpoint` POSTs `participant_identity`,
 * `participant_metadata` and `participant_attributes` in the body — all of it
 * attacker-controlled. The agent then reads `caller.subject` off the
 * participant and files tickets against it. If any of those fields reached the
 * minted token, anyone with the app could file tickets as anyone else.
 *
 * Identity must come from the verified Authorization header and nowhere else.
 */
describe('POST /v1/connection-details', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  const claimsOf = (token: string) =>
    decodeJwt(token) as {
      sub?: string;
      name?: string;
      metadata?: string;
      attributes?: Record<string, string>;
      video?: Record<string, unknown>;
      roomConfig?: { agents?: { agentName?: string }[] };
    };

  it('ignores client-supplied identity, attributes and metadata in the body', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: {
        room_name: 'r1',
        participant_identity: 'ceo@synergy',
        participant_metadata: JSON.stringify({ subject: 'ceo' }),
        participant_attributes: { 'caller.subject': 'ceo', 'caller.tenant': 'evil' },
      },
    });

    expect(res.statusCode).toBe(200);
    const claims = claimsOf(res.json().participant_token);

    expect(claims.sub).toBe('priya');
    expect(claims.attributes?.['caller.subject']).toBe('priya');
    expect(claims.attributes?.['caller.tenant']).not.toBe('evil');
    expect(JSON.stringify(claims)).not.toContain('ceo');
  });

  it('responds in snake_case, because TokenSource.endpoint parses nothing else', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: { room_name: 'r1' },
    });

    const body = res.json();
    expect(body.server_url).toBe('wss://test-project.livekit.cloud');
    expect(typeof body.participant_token).toBe('string');
    expect(body).not.toHaveProperty('serverUrl');
    expect(body).not.toHaveProperty('participantToken');
  });

  it('mints a join grant for the requested room and nothing broader', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: { room_name: 'call-priya-123' },
    });

    const claims = claimsOf(res.json().participant_token);
    expect(claims.video?.room).toBe('call-priya-123');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.roomCreate).toBeUndefined();
    expect(claims.video?.roomAdmin).toBeUndefined();
    expect(claims.video?.roomList).toBeUndefined();
  });

  it('generates a room name when the client does not supply one', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(claimsOf(res.json().participant_token).video?.room).toMatch(/\S/);
  });

  it('requests explicit agent dispatch, since naming the agent disables the automatic kind', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: { room_name: 'r1' },
    });

    const claims = claimsOf(res.json().participant_token);
    expect(claims.roomConfig?.agents?.[0]?.agentName).toBe('ticket-agent');
  });

  it('carries the display name so the agent can greet by first name', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: { room_name: 'r1' },
    });

    expect(claimsOf(res.json().participant_token).name).toBe('Priya Raman');
  });

  it('puts no PII in participant attributes, which every peer in the room can read', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('priya')),
      payload: { room_name: 'r1' },
    });

    const attrs = claimsOf(res.json().participant_token).attributes ?? {};
    const serialised = JSON.stringify(attrs);
    expect(serialised).not.toContain('@');
    expect(serialised).not.toContain('Finance');
    expect(serialised).not.toContain('Toronto');
    expect(Object.keys(attrs).sort()).toEqual(['caller.subject', 'caller.tenant']);
  });

  it('rejects a missing bearer token', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      payload: { room_name: 'r1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await signDemoToken('a-different-secret-0123456789abcdef', { subject: 'priya' });

    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(forged),
      payload: { room_name: 'r1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const stale = await signDemoToken(TEST_CONFIG.demoJwtSecret, {
      subject: 'priya',
      ttlSeconds: -60,
    });

    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(stale),
      payload: { room_name: 'r1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses the agent service token: it is not a caller and has no identity to mint', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(api.serviceToken),
      payload: { room_name: 'r1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown subject rather than minting a token for a ghost', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/connection-details',
      headers: bearer(await api.callerToken('nobody')),
      payload: { room_name: 'r1' },
    });
    expect(res.statusCode).toBe(401);
  });
});
