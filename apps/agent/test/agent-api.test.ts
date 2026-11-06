import { createServer, type Server } from 'node:http';
import { afterEach, describe, it, expect } from 'vitest';
import { AgentApiClient } from '../src/api/agent-api.js';

const PROFILE = {
  subject: 'priya',
  email: 'priya.raman@synergyit.example',
  tenantId: 'synergy-it',
  scopes: ['tickets:create'],
  displayName: 'Priya Raman',
  department: 'Finance',
  jobTitle: 'AP Specialist',
  location: 'Toronto HQ, 4th floor',
  phone: null,
  managerEmail: null,
  preferredLanguage: 'en',
  knownAssets: [],
  openTickets: [],
};

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

/** Starts a server whose handler decides what the nth request does. */
async function listen(handler: (attempt: number) => { delayMs?: number; status?: number }): Promise<string> {
  let attempts = 0;
  server = createServer((_request, response) => {
    const { delayMs = 0, status = 200 } = handler(++attempts);
    setTimeout(() => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(PROFILE));
    }, delayMs);
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

const client = (baseUrl: string, overrides: Record<string, unknown> = {}): AgentApiClient =>
  new AgentApiClient({ baseUrl, serviceToken: 'svc-token', timeoutMs: 150, ...overrides });

describe('AgentApiClient', () => {
  it('fetches a profile', async () => {
    const baseUrl = await listen(() => ({}));

    expect((await client(baseUrl).fetchProfile('priya')).displayName).toBe('Priya Raman');
  });

  /**
   * The failure that killed a live call: the profile lookup is the first thing
   * the agent does after joining, and a single slow response ended the call
   * before the caller heard anything. A contended machine stalling once is not
   * a reason to drop a call.
   */
  it('retries a timed-out request rather than failing the call', async () => {
    const baseUrl = await listen((attempt) => (attempt === 1 ? { delayMs: 400 } : {}));

    expect((await client(baseUrl).fetchProfile('priya')).subject).toBe('priya');
  });

  it('gives up after the configured number of attempts', async () => {
    const baseUrl = await listen(() => ({ delayMs: 400 }));

    await expect(client(baseUrl, { attempts: 2 }).fetchProfile('priya')).rejects.toThrow(/timed out/i);
  });

  /**
   * A wrong TICKET_API_URL and a slow API look identical in the logs
   * otherwise, and the original error was a bare DOMException naming neither.
   */
  it('names the url and the timeout when it gives up', async () => {
    const baseUrl = await listen(() => ({ delayMs: 400 }));

    await expect(client(baseUrl, { attempts: 1 }).fetchProfile('priya')).rejects.toThrow(
      /\/v1\/users\/priya.*150ms|150ms.*\/v1\/users\/priya/s,
    );
  });

  it('does not retry a request the server actually answered', async () => {
    let seen = 0;
    const baseUrl = await listen((attempt) => {
      seen = attempt;
      return { status: 404 };
    });

    await expect(client(baseUrl).fetchProfile('priya')).rejects.toThrow(/404/);
    expect(seen).toBe(1);
  });
});
