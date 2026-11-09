import { fetchConnectionDetails, signInDemo } from '../src/lib/connection';

const CONNECTION = {
  server_url: 'wss://p.livekit.cloud',
  participant_token: 'jwt.for.priya',
  room_name: 'call-priya-abc123',
};

describe('fetchConnectionDetails', () => {
  const callFetch = (
    impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>,
  ): typeof fetch => impl as unknown as typeof fetch;

  it('posts the app token as a bearer and returns the camelCased details', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;

    const details = await fetchConnectionDetails(
      { baseUrl: 'http://10.0.2.2:8080', accessToken: 'app-jwt' },
      callFetch(async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return { ok: true, status: 200, json: async () => CONNECTION };
      }),
    );

    expect(seenUrl).toBe('http://10.0.2.2:8080/v1/connection-details');
    expect((seenInit?.headers as Record<string, string>).authorization).toBe('Bearer app-jwt');
    expect(details).toEqual({
      serverUrl: 'wss://p.livekit.cloud',
      token: 'jwt.for.priya',
      roomName: 'call-priya-abc123',
    });
  });

  /**
   * Each call must be a new room: the agent is dispatched when the room is
   * created, so reusing one means nothing joins. The API generates the name
   * when the body omits it, which is why the body is empty rather than
   * carrying a room we picked.
   */
  it('names no room, so the API mints a fresh one per call', async () => {
    let body: unknown;

    await fetchConnectionDetails(
      { baseUrl: 'http://127.0.0.1:8080', accessToken: 'app-jwt' },
      callFetch(async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return { ok: true, status: 200, json: async () => CONNECTION };
      }),
    );

    expect(body).toEqual({});
  });

  /**
   * The wire format is snake_case in both directions. A camelCase response
   * parses to an empty token and then fails at connect time with nothing
   * pointing back here, so it is rejected loudly instead.
   */
  it('rejects a camelCase response rather than connecting with an empty token', async () => {
    await expect(
      fetchConnectionDetails(
        { baseUrl: 'http://127.0.0.1:8080', accessToken: 'app-jwt' },
        callFetch(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ serverUrl: 'wss://p', participantToken: 't' }),
        })),
      ),
    ).rejects.toThrow(/server_url|participant_token|invalid/i);
  });

  it('reports an expired app token as something the caller can act on', async () => {
    await expect(
      fetchConnectionDetails(
        { baseUrl: 'http://127.0.0.1:8080', accessToken: 'stale' },
        callFetch(async () => ({
          ok: false,
          status: 401,
          text: async () => '{"error":"unauthenticated"}',
        })),
      ),
    ).rejects.toThrow(/sign in again|401/i);
  });

  it('trims a trailing slash off the base url rather than requesting a double slash', async () => {
    let seenUrl = '';

    await fetchConnectionDetails(
      { baseUrl: 'http://127.0.0.1:8080/', accessToken: 'app-jwt' },
      callFetch(async (url) => {
        seenUrl = url;
        return { ok: true, status: 200, json: async () => CONNECTION };
      }),
    );

    expect(seenUrl).toBe('http://127.0.0.1:8080/v1/connection-details');
  });
});

describe('signInDemo', () => {
  it('exchanges a subject for an app token and the profile', async () => {
    const result = await signInDemo(
      'http://127.0.0.1:8080',
      'priya',
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'app-jwt',
          token_type: 'Bearer',
          expires_in: 3600,
          profile: { displayName: 'Priya Raman', subject: 'priya' },
        }),
      })) as unknown as typeof fetch,
    );

    expect(result.accessToken).toBe('app-jwt');
    expect(result.displayName).toBe('Priya Raman');
  });

  it('reports an unknown subject plainly', async () => {
    await expect(
      signInDemo(
        'http://127.0.0.1:8080',
        'nobody',
        (async () => ({ ok: false, status: 404, text: async () => 'not_found' })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/nobody|not found|404/i);
  });
});

/**
 * The failure the demo actually hits. React Native's own message names no URL,
 * so an API bound to 127.0.0.1 and an app pointed at the wrong host are the
 * same two words on screen.
 */
describe('an unreachable API', () => {
  it('names the URL it tried when the transport fails', async () => {
    await expect(
      signInDemo(
        'http://192.168.1.50:8080',
        'priya',
        (async () => {
          throw new TypeError('Network request failed');
        }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('http://192.168.1.50:8080/v1/auth/demo-login');
  });

  it('points at the loopback bind, since that is the usual cause', async () => {
    await expect(
      signInDemo(
        'http://192.168.1.50:8080',
        'priya',
        (async () => {
          throw new TypeError('Network request failed');
        }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/API_HOST is 0\.0\.0\.0/);
  });

  it('gives up rather than waiting out the platform timeout', async () => {
    jest.useFakeTimers();

    // Never settles and never aborts itself: only the helper's own timer can
    // end this, which is the behaviour under test.
    const hang = signInDemo(
      'http://192.168.1.50:8080',
      'priya',
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })) as unknown as typeof fetch,
    );

    const assertion = expect(hang).rejects.toThrow(/no response in 10s/);
    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;

    jest.useRealTimers();
  });

  it('passes the abort signal through to fetch', async () => {
    let seen: RequestInit | undefined;

    await fetchConnectionDetails(
      { baseUrl: 'http://127.0.0.1:8080', accessToken: 'app-jwt' },
      (async (_url: string, init?: RequestInit) => {
        seen = init;
        return { ok: true, status: 200, json: async () => CONNECTION };
      }) as unknown as typeof fetch,
    );

    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});
