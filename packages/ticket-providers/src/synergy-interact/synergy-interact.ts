import {
  NotImplementedError,
  type CreateTicketInput,
  type Page,
  type ProviderCallContext,
  type Ticket,
  type TicketProvider,
  type TicketQuery,
  type TicketSchemaDescriptor,
} from '@tca/contracts';

/**
 * What we need from Synergy IT before this adapter can be written.
 *
 * Exported rather than left in a comment so it shows up in test output and can
 * be pasted straight into an email.
 */
export const INTERACT_OPEN_QUESTIONS: readonly string[] = [
  'Authentication scheme: API key, OAuth client credentials, or session cookie? Where are credentials issued?',
  'Ticket creation endpoint: URL, method, request body shape, and success response shape.',
  'Category taxonomy: the exact list of valid values, and whether it is fetchable at runtime.',
  'Priority/severity values: the exact list, and how they map to our low/normal/high/urgent.',
  'Reporter lookup: does Interact key users by email, employee ID, or an internal subject? Can we set the reporter on behalf of a user?',
  'Deduplication: does the create endpoint honour an Idempotency-Key header, or must we keep our own submission ledger?',
  'Attachments and comments: are they supported, and via which endpoints?',
  'Rate limits and timeouts, plus whether there is a non-production sandbox we can test against.',
] as const;

/**
 * Placeholder for the real Synergy Interact integration.
 *
 * Every method throws rather than returning a plausible-looking result: a
 * provider that silently swallows tickets is far worse than one that refuses to
 * start. Its contract-suite block in the sibling test file is skipped until
 * INTERACT_OPEN_QUESTIONS are answered — unskip it, then make it pass.
 */
export class SynergyInteractProvider implements TicketProvider {
  readonly name = 'synergy-interact';

  async createTicket(_input: CreateTicketInput, _ctx: ProviderCallContext): Promise<Ticket> {
    throw new NotImplementedError('SynergyInteractProvider.createTicket');
  }

  async getTicket(_id: string, _ctx: ProviderCallContext): Promise<Ticket | null> {
    throw new NotImplementedError('SynergyInteractProvider.getTicket');
  }

  async findByIdempotencyKey(_key: string, _ctx: ProviderCallContext): Promise<Ticket | null> {
    throw new NotImplementedError('SynergyInteractProvider.findByIdempotencyKey');
  }

  async listTickets(_query: TicketQuery, _ctx: ProviderCallContext): Promise<Page<Ticket>> {
    throw new NotImplementedError('SynergyInteractProvider.listTickets');
  }

  async addComment(_id: string, _body: string, _ctx: ProviderCallContext): Promise<void> {
    throw new NotImplementedError('SynergyInteractProvider.addComment');
  }

  async describeSchema(_ctx: ProviderCallContext): Promise<TicketSchemaDescriptor> {
    throw new NotImplementedError('SynergyInteractProvider.describeSchema');
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return {
      ok: false,
      detail: `Synergy Interact adapter not implemented. ${INTERACT_OPEN_QUESTIONS.length} open questions.`,
    };
  }
}
