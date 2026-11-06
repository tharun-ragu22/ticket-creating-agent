import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApi, bearer, type TestApi } from './helpers.js';

/**
 * The board is disposable demo scaffolding — Interact has its own UI — and is
 * exempt from TDD by decision in the plan. It gets a smoke test that it is
 * served, and tests that its unauthenticated read endpoints cannot survive
 * into a real configuration. That second part is not about the board: an
 * unauthenticated ticket list left switched on in production is exactly the
 * kind of thing that ships.
 */
describe('GET /board', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi(); });
  afterAll(async () => { await api?.close(); });

  it('serves the page', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/board' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<table');
  });

  it('lists every reporter tickets, since it is an operator view', async () => {
    for (const [i, subject] of ['priya', 'dave'].entries()) {
      await api.app.inject({
        method: 'POST',
        url: '/v1/tickets',
        headers: { ...bearer(api.serviceToken), 'idempotency-key': `board-seed-${i}-0000000` },
        payload: {
          title: `Board seed ticket number ${i}`,
          description: 'A seeded ticket so the board has something to render in the smoke test.',
          category: 'software',
          priority: 'normal',
          affectedAsset: null,
          impact: { scope: 'self', usersAffected: 1, workBlocked: false },
          troubleshootingTried: [],
          source: {
            channel: 'voice',
            sessionId: `sess_board_${i}`,
            roomName: `room_board_${i}`,
            startedAt: '2026-11-05T09:00:00.000Z',
          },
          reporterSubject: subject,
        },
      });
    }

    const res = await api.app.inject({ method: 'GET', url: '/v1/board/tickets' });

    expect(res.statusCode).toBe(200);
    const subjects = res.json().items.map((t: { reporter: { subject: string } }) => t.reporter.subject);
    expect(new Set(subjects)).toEqual(new Set(['priya', 'dave']));
  });
});

describe('the board under a non-demo configuration', () => {
  let api: TestApi;
  beforeAll(async () => { api = await buildTestApi({ identityProvider: 'oidc' }); });
  afterAll(async () => { await api?.close(); });

  it('does not register its unauthenticated ticket list', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/v1/board/tickets' })).statusCode)
      .toBe(404);
  });

  it('does not serve the page either', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/board' })).statusCode).toBe(404);
  });
});
