import { z } from 'zod';

/**
 * Talking to our API, not to LiveKit.
 *
 * livekit-client ships TokenSource.endpoint, which speaks exactly this wire
 * format, but it is deliberately not used: it caches by the identity of the
 * options object passed to fetch(), so a mutated object silently returns a
 * stale token, and a stale token means a room whose agent job has already
 * ended. One explicit fetch per call is both simpler and testable without a
 * LiveKit room.
 */
export interface ApiSession {
  baseUrl: string;
  accessToken: string;
}

/** The snake_case body our API returns. Both directions are snake_case. */
const ConnectionDetailsResponse = z.object({
  server_url: z.string().min(1),
  participant_token: z.string().min(1),
  room_name: z.string().min(1),
});

const DemoLoginResponse = z.object({
  access_token: z.string().min(1),
  profile: z.object({ subject: z.string().min(1), displayName: z.string().min(1) }),
});

export interface ConnectionDetails {
  serverUrl: string;
  token: string;
  roomName: string;
}

export interface DemoSession {
  subject: string;
  displayName: string;
  accessToken: string;
}

/**
 * How long to wait for our API before calling it unreachable.
 *
 * iOS waits 60 seconds by default, which on a phone is indistinguishable from
 * an app that is simply broken. A dev API on the same network answers in
 * milliseconds, so anything past this is not slow, it is not there.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * fetch, with the URL in the failure.
 *
 * React Native reports an unreachable host as a bare "Network request failed"
 * or "The request timed out", naming nothing — and this app derives its API
 * base from whichever host served the bundle, so the one fact that separates
 * "the API is down" from "the phone is asking the wrong machine" is exactly
 * the fact the error leaves out. A loopback API_HOST, a stale
 * EXPO_PUBLIC_API_BASE_URL and a firewall all present identically without it.
 */
async function request(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetchImpl(url, { ...init, signal: abort.signal });
  } catch (cause) {
    const reason = abort.signal.aborted
      ? `no response in ${REQUEST_TIMEOUT_MS / 1000}s`
      : cause instanceof Error
        ? cause.message
        : String(cause);

    throw new Error(
      `Could not reach the API at ${url} — ${reason}. Check that it is running, ` +
        'and that API_HOST is 0.0.0.0: a loopback bind is unreachable from a phone.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Credentials for one call.
 *
 * The body is empty on purpose. The agent is dispatched when the room is
 * created, so asking for a room we have already used means no job is
 * dispatched and nothing joins; an empty body makes the API mint
 * `call-<subject>-<random>` every time.
 */
export async function fetchConnectionDetails(
  session: ApiSession,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionDetails> {
  const response = await request(
    `${trimSlash(session.baseUrl)}/v1/connection-details`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    },
    fetchImpl,
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Your session has expired — sign in again. (401 from /v1/connection-details)');
    }
    throw new Error(
      `POST /v1/connection-details failed with ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }

  const parsed = ConnectionDetailsResponse.safeParse(await response.json());
  if (!parsed.success) {
    // Loud on purpose: a camelCase body parses to an empty token and then
    // fails at connect time with nothing pointing back at the response shape.
    throw new Error(
      'Invalid /v1/connection-details response: expected snake_case server_url, ' +
        `participant_token and room_name. Got: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }

  return {
    serverUrl: parsed.data.server_url,
    token: parsed.data.participant_token,
    roomName: parsed.data.room_name,
  };
}

/**
 * Stands in for real sign-in.
 *
 * Only exists while IDENTITY_PROVIDER=demo-jwt; the route is not registered
 * under a real identity provider, so this call fails by design once Okta or
 * Entra is wired up, and the app will hold a token from the OIDC flow instead.
 */
export async function signInDemo(
  baseUrl: string,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoSession> {
  const response = await request(
    `${trimSlash(baseUrl)}/v1/auth/demo-login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject }),
    },
    fetchImpl,
  );

  if (!response.ok) {
    throw new Error(
      `Could not sign in as "${subject}" (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const { access_token, profile } = DemoLoginResponse.parse(await response.json());
  return { subject: profile.subject, displayName: profile.displayName, accessToken: access_token };
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');
