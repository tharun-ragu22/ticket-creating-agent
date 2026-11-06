import { describe, it, expect } from 'vitest';
import type { ProviderCallContext } from '@tca/contracts';
import { makeCreateTicketInput } from '@tca/test-helpers';
import { SynergyInteractProvider, INTERACT_OPEN_QUESTIONS } from './synergy-interact.js';

const ctx: ProviderCallContext = {
  actor: { subject: 'priya', email: 'priya.raman@synergyit.example', displayName: 'Priya Raman' },
  requestId: 'req_interact',
};

/*
 * The real contract suite cannot run until Synergy IT gives us an API spec and a
 * sandbox. It is wired up and skipped rather than absent, so the remaining work
 * is visible in the test output instead of living in someone's head:
 *
 *   describeTicketProviderContract('SynergyInteractProvider', async () => ...)
 *
 * Unskip it once INTERACT_OPEN_QUESTIONS below are answered.
 */
describe.skip('SynergyInteractProvider contract (blocked on API access)', () => {
  it('must pass the identical TicketProvider contract suite', () => {
    expect(true).toBe(true);
  });
});

describe('SynergyInteractProvider stub', () => {
  const provider = new SynergyInteractProvider();

  it('identifies itself distinctly from the demo provider', () => {
    expect(provider.name).toBe('synergy-interact');
  });

  it('fails loudly rather than silently dropping a ticket', async () => {
    await expect(provider.createTicket(makeCreateTicketInput(), ctx)).rejects.toThrow(
      /not implemented/i,
    );
  });

  it('reports unhealthy, so it cannot be enabled by accident', async () => {
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: false });
  });

  it('documents what we still need from Synergy IT', () => {
    expect(INTERACT_OPEN_QUESTIONS.length).toBeGreaterThanOrEqual(8);
  });
});
