import type {
  CallEvent,
  CallSource,
  CallerProfile,
  Ticket,
  TicketDraft,
  TicketProvider,
  TicketSchemaDescriptor,
  TranscriptRef,
  TranscriptTurn,
} from '@tca/contracts';

/**
 * A draft the caller has been read back to.
 *
 * `proposedAt` is the whole point of the type: create_ticket refuses to run
 * without it, so "propose before create" is a structural guard rather than a
 * line in the prompt. Prompt-only guards leak.
 */
export interface ProposedDraft {
  draft: TicketDraft;
  proposedAt: string;
}

/** Pushes structured payloads to the app on the tca.ticket topic. */
export interface CallEventSink {
  publish(event: CallEvent): Promise<void>;
}

/** Collects what was said, and persists it when a ticket is filed. */
export interface TranscriptRecorder {
  record(turn: TranscriptTurn): void;
  readonly turns: readonly TranscriptTurn[];
  /** Persists and returns a ref, or null when there is nothing to save. */
  save(): Promise<TranscriptRef | null>;
}

/**
 * Everything the tools are allowed to see.
 *
 * `profile` is the reason this type exists: the reporter comes from here, so
 * no tool argument can influence who a ticket is filed for. The LLM can only
 * fill in the fields of ProposeTicketToolInput, which has no reporter key at
 * all.
 *
 * Note what is absent: no AgentSession, no LLM, no room. Tools read this and
 * nothing else, which is what makes tier 4 a plain function test.
 */
export interface CallUserData {
  readonly profile: CallerProfile;
  readonly source: CallSource;
  readonly schema: TicketSchemaDescriptor;
  readonly tickets: TicketProvider;
  readonly events: CallEventSink;
  readonly transcript: TranscriptRecorder;

  /** Set by propose_ticket, read by create_ticket. */
  draft: ProposedDraft | null;
  /** Set by create_ticket. Its presence short-circuits a second call. */
  createdTicket: Ticket | null;
  /**
   * Counts genuinely distinct tickets within one call, so a second real
   * problem gets its own idempotency key instead of colliding with the first.
   */
  draftSequence: number;
  /** True once the caller has asked to stop. */
  cancelled: boolean;
}

export interface CreateCallUserDataInput {
  profile: CallerProfile;
  source: CallSource;
  schema: TicketSchemaDescriptor;
  tickets: TicketProvider;
  events: CallEventSink;
  transcript: TranscriptRecorder;
}

export function createCallUserData(input: CreateCallUserDataInput): CallUserData {
  return {
    ...input,
    draft: null,
    createdTicket: null,
    draftSequence: 1,
    cancelled: false,
  };
}
