import type { CreateTicketInput, Ticket, TicketStatus } from './ticket.js';

export interface ProviderCallContext {
  actor: { subject: string; email: string; displayName: string };
  requestId: string;
  signal?: AbortSignal;
}

export interface TicketFieldOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Lets the agent prompt adapt to whatever the live provider actually accepts,
 * so Synergy Interact's real taxonomy works without rewriting the prompt.
 */
export interface TicketSchemaDescriptor {
  categories: TicketFieldOption[];
  priorities: TicketFieldOption[];
  requiredFields: string[];
  supportsAttachments: boolean;
  supportsComments: boolean;
}

export interface TicketQuery {
  status?: TicketStatus[];
  reporterSubject?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TicketProvider {
  readonly name: string;
  createTicket(input: CreateTicketInput, ctx: ProviderCallContext): Promise<Ticket>;
  /**
   * By internal id **or** by the providerTicketId the provider issued.
   *
   * Both, because the agent only ever holds the latter — OpenTicketRef carries
   * providerTicketId alone, so that no tool argument can name a ticket by a
   * handle the caller was never given — and it is also the reference read back
   * on the call. An implementation that resolves only its private id makes
   * commenting unreachable. The contract suite pins this.
   */
  getTicket(ref: string, ctx: ProviderCallContext): Promise<Ticket | null>;
  /**
   * On the interface because a real ITSM may not honour an Idempotency-Key
   * header. If Interact does not, its adapter satisfies this from a local
   * submissions table — the contract holds either way.
   */
  findByIdempotencyKey(key: string, ctx: ProviderCallContext): Promise<Ticket | null>;
  listTickets(query: TicketQuery, ctx: ProviderCallContext): Promise<Page<Ticket>>;
  /** Accepts either reference, as getTicket does. Rejects one that matches nothing. */
  addComment(ref: string, body: string, ctx: ProviderCallContext): Promise<void>;
  describeSchema(ctx: ProviderCallContext): Promise<TicketSchemaDescriptor>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
