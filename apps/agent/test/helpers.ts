import type { voice } from '@livekit/agents';
import type {
  CallEvent,
  CallSource,
  CallerProfile,
  CreateTicketInput,
  Page,
  ProviderCallContext,
  Ticket,
  TicketProvider,
  TicketQuery,
  TicketSchemaDescriptor,
  TranscriptRef,
  TranscriptTurn,
} from '@tca/contracts';
import {
  createCallUserData,
  type CallEventSink,
  type CallUserData,
  type TranscriptRecorder,
} from '../src/session/state.js';

export const PRIYA_PROFILE: CallerProfile = {
  subject: 'priya',
  email: 'priya.raman@synergyit.example',
  tenantId: 'synergy-it',
  scopes: ['tickets:create', 'tickets:read'],
  displayName: 'Priya Raman',
  department: 'Finance',
  jobTitle: 'AP Specialist',
  location: 'Toronto HQ, 4th floor',
  phone: '+1-416-555-0134',
  managerEmail: 'lena.ortiz@synergyit.example',
  preferredLanguage: 'en',
  knownAssets: [
    { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
    { kind: 'mobile', label: 'iPhone 15', identifier: 'SYN-MO-0442' },
  ],
  openTickets: [
    { providerTicketId: 'SI-10388', title: 'VPN drops on hotel wifi', status: 'pending' },
  ],
};

export const CALL_SOURCE: CallSource = {
  channel: 'voice',
  sessionId: 'sess_test',
  roomName: 'call-priya-test',
  startedAt: '2026-11-05T09:00:00.000Z',
};

export const SCHEMA: TicketSchemaDescriptor = {
  categories: [
    { value: 'software', label: 'Software' },
    { value: 'hardware', label: 'Hardware' },
    { value: 'network', label: 'Network' },
  ],
  priorities: [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ],
  requiredFields: ['title', 'description', 'category', 'priority'],
  supportsAttachments: false,
  supportsComments: true,
};

export const VALID_DRAFT = {
  title: 'Outlook will not launch after the morning update',
  description:
    'Outlook fails to open since the Windows update this morning. Blocks the invoice ' +
    'run and two colleagues report the same thing.',
  category: 'software' as const,
  priority: 'high' as const,
  affectedAsset: {
    kind: 'laptop' as const,
    label: 'ThinkPad X1 Carbon',
    identifier: 'SYN-LT-2291',
  },
  impact: { scope: 'team' as const, usersAffected: 3, workBlocked: true },
  troubleshootingTried: ['restarted the laptop'],
};

export class RecordingEventSink implements CallEventSink {
  readonly published: CallEvent[] = [];

  async publish(event: CallEvent): Promise<void> {
    this.published.push(event);
  }

  kinds(): string[] {
    return this.published.map((e) => e.kind);
  }
}

export class FakeTranscript implements TranscriptRecorder {
  readonly turns: TranscriptTurn[] = [];
  saveCalls = 0;
  constructor(private readonly ref: TranscriptRef | null = { id: 'tr_fake', uri: '/t/tr_fake' }) {}

  record(turn: TranscriptTurn): void {
    this.turns.push(turn);
  }

  async save(): Promise<TranscriptRef | null> {
    this.saveCalls += 1;
    return this.ref;
  }
}

/**
 * A TicketProvider that counts calls.
 *
 * The call count is the assertion that matters for the duplicate-ticket
 * defence: "returns the existing reference" and "did not hit the provider
 * twice" are different claims, and only the second one rules out a second row.
 */
export class CountingTicketProvider implements TicketProvider {
  readonly name = 'counting';
  createCalls: CreateTicketInput[] = [];
  commentCalls: { id: string; body: string }[] = [];
  /** Set to make the next createTicket reject, for the EV-ROB-07 path. */
  failWith: Error | null = null;

  private readonly byKey = new Map<string, Ticket>();
  private seq = 10_000;

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    this.createCalls.push(input);
    if (this.failWith) throw this.failWith;

    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return existing;

    this.seq += 1;
    const { idempotencyKey: _unused, ...rest } = input;
    const now = '2026-11-05T09:05:00.000Z';
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
    // Either reference, as a real provider must: the agent only ever holds
    // providerTicketId. See the contract suite.
    return (
      [...this.byKey.values()].find((t) => t.id === id || t.providerTicketId === id) ?? null
    );
  }

  async findByIdempotencyKey(key: string): Promise<Ticket | null> {
    return this.byKey.get(key) ?? null;
  }

  async listTickets(query: TicketQuery): Promise<Page<Ticket>> {
    const items = [...this.byKey.values()].filter(
      (t) => !query.reporterSubject || t.reporter.subject === query.reporterSubject,
    );
    return { items, nextCursor: null };
  }

  async addComment(id: string, body: string, ctx: ProviderCallContext): Promise<void> {
    this.commentCalls.push({ id, body });

    /*
     * Stored on the ticket, not just counted, so a test can tell "the comment
     * was sent" from "the comment is on the ticket the app will be shown".
     * A reference this fake has never issued — the caller's pre-existing open
     * tickets live in the profile, not here — is still recorded: existence is
     * the real provider's business, and the contract suite checks it there.
     */
    const target = await this.getTicket(id);
    if (!target) return;

    const comment = {
      id: `cmt_${this.commentCalls.length}`,
      authorSubject: ctx.actor.subject,
      body,
      createdAt: '2026-11-05T09:06:00.000Z',
    };
    this.byKey.set(
      [...this.byKey.entries()].find(([, t]) => t.id === target.id)![0],
      { ...target, comments: [...target.comments, comment] },
    );
  }

  async describeSchema(): Promise<TicketSchemaDescriptor> {
    return SCHEMA;
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

export interface ToolHarness {
  userData: CallUserData;
  provider: CountingTicketProvider;
  events: RecordingEventSink;
  transcript: FakeTranscript;
  /** What end_call asked the session to do. */
  shutdowns: { drain?: boolean; reason?: string }[];
  /** Pass as the second argument to a tool's execute(). */
  opts: { ctx: voice.RunContext<unknown>; toolCallId: string; abortSignal: AbortSignal };
}

/**
 * A tool-call context built by hand.
 *
 * RunContext's real constructor needs an AgentSession and a SpeechHandle, and
 * a tier-4 test has neither. This is deliberately a minimal stand-in exposing
 * only `userData` and `session` — the two things the tools are allowed to
 * touch. If a tool ever needs more of RunContext, that is a signal it is doing
 * conversation work that belongs in the agent, not in a tool.
 */
export function makeToolHarness(over: Partial<CallUserData> = {}): ToolHarness {
  const provider = new CountingTicketProvider();
  const events = new RecordingEventSink();
  const transcript = new FakeTranscript();

  const userData: CallUserData = {
    ...createCallUserData({
      profile: PRIYA_PROFILE,
      source: CALL_SOURCE,
      schema: SCHEMA,
      tickets: provider,
      events,
      transcript,
    }),
    ...over,
  };

  const shutdowns: { drain?: boolean; reason?: string }[] = [];

  const ctx = {
    userData,
    session: {
      userData,
      shutdown: (options?: { drain?: boolean; reason?: string }) => {
        shutdowns.push(options ?? {});
      },
    },
  } as unknown as voice.RunContext<unknown>;

  return {
    userData,
    provider,
    events,
    transcript,
    shutdowns,
    opts: { ctx, toolCallId: 'call_test_1', abortSignal: AbortSignal.timeout(30_000) },
  };
}

/** A stand-in handoff target. handoff() only stores the reference. */
export const STUB_AGENT = { __stub: 'confirm-agent' } as unknown as voice.Agent;

/**
 * Whether a tool returned an agent handoff.
 *
 * @livekit/agents exports `isAgentHandoff` from its internal tool_context
 * module, but the package's `exports` map publishes only the root entry and
 * the llm namespace does not re-export it, so it is unreachable from here.
 * The brand symbol is the contract the framework itself keys on.
 */
export function isHandoff(value: unknown): value is { agent: unknown; returns?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  return Object.getOwnPropertySymbols(value).some((s) => s.description === 'handoff');
}
