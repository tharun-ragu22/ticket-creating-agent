import type {
  CallEvent,
  CallSource,
  CallerProfile,
  CreateTicketInput,
  Page,
  Ticket,
  TicketProvider,
  TicketQuery,
  TicketSchemaDescriptor,
  TranscriptRef,
  TranscriptTurn,
} from '@tca/contracts';

/**
 * An in-memory ticket store for evals.
 *
 * Deliberately not the HTTP client or PGlite: a scored run makes ~50 calls to
 * a real model and should not also require a database. Idempotency is still
 * honoured because EV-ROB-03 depends on it.
 */
export class EvalTicketProvider implements TicketProvider {
  readonly name = 'eval';
  readonly createCalls: CreateTicketInput[] = [];
  readonly commentCalls: { id: string; body: string }[] = [];
  /** Set to make createTicket reject, for EV-ROB-07. */
  failWith: Error | null = null;

  private readonly byKey = new Map<string, Ticket>();
  private seq = 10_400;

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    this.createCalls.push(input);
    if (this.failWith) throw this.failWith;

    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return existing;

    this.seq += 1;
    const { idempotencyKey: _key, ...rest } = input;
    const now = new Date().toISOString();

    const ticket: Ticket = {
      ...rest,
      id: `tkt_${this.seq}`,
      providerTicketId: `SI-${this.seq}`,
      providerName: this.name,
      status: 'new',
      url: null,
      createdAt: now,
      updatedAt: now,
      comments: [],
    };
    this.byKey.set(input.idempotencyKey, ticket);
    return ticket;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return [...this.byKey.values()].find((t) => t.id === id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Ticket | null> {
    return this.byKey.get(key) ?? null;
  }

  async listTickets(query: TicketQuery): Promise<Page<Ticket>> {
    return {
      items: [...this.byKey.values()].filter(
        (t) => !query.reporterSubject || t.reporter.subject === query.reporterSubject,
      ),
      nextCursor: null,
    };
  }

  async addComment(id: string, body: string): Promise<void> {
    this.commentCalls.push({ id, body });
  }

  async describeSchema(): Promise<TicketSchemaDescriptor> {
    throw new Error('describeSchema is injected directly in evals');
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  /** The one ticket the case produced, or null. */
  get ticket(): Ticket | null {
    return [...this.byKey.values()][0] ?? null;
  }
}

export class RecordingEvents {
  readonly published: CallEvent[] = [];
  async publish(event: CallEvent): Promise<void> {
    this.published.push(event);
  }
}

/** Collects turns; evals do not persist transcripts. */
export class EvalTranscript {
  readonly turns: TranscriptTurn[] = [];
  record(turn: TranscriptTurn): void {
    this.turns.push(turn);
  }
  async save(): Promise<TranscriptRef | null> {
    return null;
  }
}

export function callSourceFor(caseId: string): CallSource {
  return {
    channel: 'voice',
    sessionId: `eval_${caseId}`,
    roomName: `eval-${caseId}`,
    startedAt: '2026-11-05T09:00:00.000Z',
  };
}

export type { CallerProfile };
