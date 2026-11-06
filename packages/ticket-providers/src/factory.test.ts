import { describe, it, expect } from 'vitest';
import { createTestDatabase } from '@tca/test-helpers';
import { createTicketProvider } from './factory.js';
import { DemoTicketProvider } from './demo/demo-provider.js';
import { SynergyInteractProvider } from './synergy-interact/synergy-interact.js';

describe('createTicketProvider', () => {
  it('builds the demo provider when configured for demo', async () => {
    const db = await createTestDatabase();
    const provider = createTicketProvider({ provider: 'demo', sql: db.sql });

    expect(provider).toBeInstanceOf(DemoTicketProvider);
    expect(provider.name).toBe('demo');
    await db.teardown();
  });

  it('builds the Interact provider when configured for synergy-interact', () => {
    const provider = createTicketProvider({ provider: 'synergy-interact' });

    expect(provider).toBeInstanceOf(SynergyInteractProvider);
    expect(provider.name).toBe('synergy-interact');
  });

  // A typo in TICKET_PROVIDER must stop the process, not quietly fall back to a
  // provider nobody chose and start filing tickets into the wrong system.
  it('throws on an unknown provider name rather than defaulting', () => {
    // @ts-expect-error deliberately invalid configuration
    expect(() => createTicketProvider({ provider: 'jira' })).toThrow(/unknown ticket provider/i);
  });

  it('refuses to build the demo provider without a database', () => {
    // @ts-expect-error sql is required for the demo provider
    expect(() => createTicketProvider({ provider: 'demo' })).toThrow(/requires a database/i);
  });

  it('names every provider it can build in the error, so the fix is obvious', () => {
    // @ts-expect-error deliberately invalid configuration
    expect(() => createTicketProvider({ provider: 'jira' })).toThrow(/demo/);
  });
});
