// NOTE: describeTicketProviderContract is deliberately NOT re-exported here.
// It imports vitest at module scope, so a barrel export would pull the test
// framework into every runtime that imports this package — which crashes the
// API at boot. Test suites import it from '@tca/ticket-providers/contract-tests'.
export { DemoTicketProvider, migrate } from './demo/demo-provider.js';
export {
  SynergyInteractProvider,
  INTERACT_OPEN_QUESTIONS,
} from './synergy-interact/synergy-interact.js';
export {
  TicketApiClient,
  TicketApiError,
  type TicketApiClientOptions,
} from './http/api-client.js';
export {
  createTicketProvider,
  type TicketProviderConfig,
  type TicketProviderName,
} from './factory.js';
