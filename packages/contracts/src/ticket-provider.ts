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
  getTicket(id: string, ctx: ProviderCallContext): Promise<Ticket | null>;
  /**
   * On the interface because a real ITSM may not honour an Idempotency-Key
   * header. If Interact does not, its adapter satisfies this from a local
   * submissions table — the contract holds either way.
   */
  findByIdempotencyKey(key: string, ctx: ProviderCallContext): Promise<Ticket | null>;
  listTickets(query: TicketQuery, ctx: ProviderCallContext): Promise<Page<Ticket>>;
  addComment(id: string, body: string, ctx: ProviderCallContext): Promise<void>;
  describeSchema(ctx: ProviderCallContext): Promise<TicketSchemaDescriptor>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
