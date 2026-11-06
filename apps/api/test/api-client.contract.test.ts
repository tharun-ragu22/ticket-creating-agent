import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCreateTicketInput } from '@tca/test-helpers';
import { TicketApiClient } from '@tca/ticket-providers';
import { describeTicketProviderContract } from '@tca/ticket-providers/contract-tests';
import type { ProviderCallContext } from '@tca/contracts';
import { buildTestApi, type TestApi } from './helpers.js';

/**
 * The second run of the provider contract suite, over real HTTP.
 *
 * This is what makes requirement #4 a proven property rather than a claim.
 * The agent programs against TicketProvider; if TicketApiClient passes the
 * same 22 assertions DemoTicketProvider passes, then the HTTP hop is
 * transparent and SynergyInteractProvider can be dropped in behind the API
 * without the agent noticing.
 *
 * It uses a listening socket rather than app.inject so that status codes,
 * header casing and JSON serialisation are all exercised for real — the three
 * places an in-process fake would quietly diverge.
 */
describeTicketProviderContract('TicketApiClient over HTTP', async () => {
  const api = await buildTestApi();
  const address = await api.app.listen({ host: '127.0.0.1', port: 0 });

  return {
    provider: new TicketApiClient({ baseUrl: address, serviceToken: api.serviceToken }),
    teardown: () => api.close(),
  };
});

describe('TicketApiClient transport behaviour', () => {
  let api: TestApi;
  let client: TicketApiClient;

  const ctx: ProviderCallContext = {
    actor: { subject: 'agent', email: '', displayName: 'Voice ticketing agent' },
    requestId: 'req_transport',
  };

  beforeAll(async () => {
    api = await buildTestApi();
    const address = await api.app.listen({ host: '127.0.0.1', port: 0 });
    client = new TicketApiClient({ baseUrl: address, serviceToken: api.serviceToken });
  });
  afterAll(async () => { await api?.close(); });

  it('reports its name as the transport, not as the backing store', async () => {
    // The agent logs provider.name. Reporting 'demo' here would hide the fact
    // that a hop is involved when the backing store is swapped for Interact.
    expect(client.name).toBe('ticket-api');
  });

  it('surfaces a rejected service token as an error rather than a silent empty result', async () => {
    const unauthorised = new TicketApiClient({
      baseUrl: `http://127.0.0.1:${(api.app.server.address() as { port: number }).port}`,
      serviceToken: 'wrong-service-token-000000',
    });

    await expect(unauthorised.createTicket(makeCreateTicketInput(), ctx)).rejects.toThrow(/401/);
  });

  it('includes the request id, so one call can be traced across the agent and the API', async () => {
    await client.describeSchema({ ...ctx, requestId: 'req_traced_1' });
    expect(api.requestLog.get('req_traced_1')).toBe('/v1/ticket-schema');
  });

  it('propagates a 400 from an invalid draft instead of returning a half-built ticket', async () => {
    const bad = { ...makeCreateTicketInput(), title: 'tiny' };
    await expect(client.createTicket(bad, ctx)).rejects.toThrow(/400/);
  });
});
