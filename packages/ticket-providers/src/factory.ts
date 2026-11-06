import type { SqlClient, TicketProvider } from '@tca/contracts';
import { DemoTicketProvider } from './demo/demo-provider.js';
import { SynergyInteractProvider } from './synergy-interact/synergy-interact.js';

export type TicketProviderName = 'demo' | 'synergy-interact';

export type TicketProviderConfig =
  | { provider: 'demo'; sql: SqlClient }
  | { provider: 'synergy-interact' };

const KNOWN: readonly TicketProviderName[] = ['demo', 'synergy-interact'];

/**
 * The only place a concrete ticket provider is named.
 *
 * Everything else — the agent, the API routes, the tools — depends on the
 * TicketProvider interface, so pointing the system at Synergy Interact is a
 * change to TICKET_PROVIDER rather than a change to code.
 */
export function createTicketProvider(config: TicketProviderConfig): TicketProvider {
  switch (config.provider) {
    case 'demo':
      if (!config.sql) {
        throw new Error('Ticket provider "demo" requires a database (pass `sql`)');
      }
      return new DemoTicketProvider(config.sql);

    case 'synergy-interact':
      return new SynergyInteractProvider();

    default: {
      // Misconfiguration must halt startup. Falling back to a default would
      // mean filing real tickets into whichever system happened to be wired up.
      const name = (config as { provider: string }).provider;
      throw new Error(
        `Unknown ticket provider "${name}". Valid values: ${KNOWN.join(', ')}.`,
      );
    }
  }
}
