import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { decodeJwt } from 'jose';
import { buildTestApi, bearer, type TestApi } from './helpers.js';

describe('POST /v1/auth/demo-login', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('issues an app token for a seeded user', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/demo-login',
      payload: { subject: 'priya' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(decodeJwt(body.access_token).sub).toBe('priya');
    expect(body.expires_in).toBeGreaterThan(0);
  });

  it('returns the profile so the app can render a name without a second round trip', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/demo-login',
      payload: { subject: 'priya' },
    });

    expect(res.json().profile).toMatchObject({
      subject: 'priya',
      displayName: 'Priya Raman',
      department: 'Finance',
    });
  });

  it('404s on an unknown subject', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/demo-login',
      payload: { subject: 'nobody' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s when subject is missing', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/demo-login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists the demo users, so the app can offer a picker instead of a password field', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/auth/demo-users' });

    expect(res.statusCode).toBe(200);
    const subjects = res.json().items.map((u: { subject: string }) => u.subject);
    expect(subjects).toContain('priya');
    expect(subjects).toContain('dave');
  });
});

/**
 * The demo login mints tokens for anyone who asks, by design. It must be
 * impossible to leave switched on once a real identity provider is configured.
 */
describe('POST /v1/auth/demo-login with a real identity provider', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi({ identityProvider: 'oidc' }); });
  afterAll(async () => { await api?.close(); });

  it('is not registered at all', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/demo-login',
      payload: { subject: 'priya' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/me', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('returns the caller profile for a valid bearer token', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(await api.callerToken('dave')),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subject: 'dave', displayName: 'Dave Okonjo' });
  });

  it('401s without a token', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
  });

  it('401s on a malformed Authorization header', async () => {
    const res = await api.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Basic cHJpeWE6cHc=' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /healthz', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('reports the wired providers so a misconfigured deploy is visible', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      ticketProvider: 'demo',
      identityProvider: 'demo-jwt',
    });
  });

  it('needs no authentication', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).not.toBe(401);
  });
});
