import { llm, voice } from '@livekit/agents';
import { buildSystemPrompt, renderReadback } from '@tca/contracts';
import { makeToolTable } from './tools/index.js';
import type { CallUserData } from './session/state.js';

/**
 * The tools both agents share.
 *
 * Built once and handed to both, with the handoff targets resolved lazily
 * because the two agents reference each other.
 */
function buildTools(): ReturnType<typeof makeToolTable> {
  let intake: voice.Agent | null = null;
  let confirm: voice.Agent | null = null;

  const table = makeToolTable({
    intakeAgent: () => {
      if (!intake) throw new Error('IntakeAgent was not registered before a handoff to it');
      return intake;
    },
    confirmAgent: () => {
      if (!confirm) throw new Error('ConfirmAgent was not registered before a handoff to it');
      return confirm;
    },
  });

  // Published on the table so createAgents can close the cycle.
  Object.defineProperty(table, '__register', {
    value: (agents: { intake: voice.Agent; confirm: voice.Agent }) => {
      intake = agents.intake;
      confirm = agents.confirm;
    },
    enumerable: false,
  });

  return table;
}

/**
 * Barge-in and endpointing.
 *
 * `resumeFalseInterruption` is the setting that matters most here: the
 * read-back is the longest thing the agent says, and a caller who hums
 * "mm-hmm" halfway through would otherwise kill it and have to be asked
 * again. Interruption cancels speech, never a running tool, so the ticket
 * write is never gated on the sentence finishing.
 */
const TURN_HANDLING = {
  // undefined, not null: the session auto-provisions a turn detector and picks
  // the best available mode. Passing null opts out of turn detection entirely.
  turnDetection: undefined,
  interruption: {
    mode: 'adaptive' as const,
    resumeFalseInterruption: true,
    falseInterruptionTimeout: 1000,
  },
  endpointing: { mode: 'dynamic' as const, minDelay: 300, maxDelay: 3000 },
  preemptiveGeneration: { enabled: true },
};

/**
 * Stops markdown and emoji reaching TTS, which reads them aloud.
 *
 * This is an AgentSession option rather than an Agent one, and
 * ['filter_markdown', 'filter_emoji'] is already the framework default — so
 * the belt-and-braces the plan called for is on by default. Named here so the
 * session wiring sets it explicitly rather than relying on that default.
 */
const TTS_TEXT_TRANSFORMS = ['filter_markdown', 'filter_emoji'] as const;

/**
 * Gathers the problem. Cannot file anything: `create_ticket` is not on its
 * tool list at all, so skipping confirmation is not merely discouraged, it is
 * unreachable from this agent.
 */
export class IntakeAgent extends voice.Agent<CallUserData> {
  constructor(instructions: string, tools: ReturnType<typeof makeToolTable>) {
    super({
      instructions,
      tools: [
        tools.lookup_known_assets,
        tools.propose_ticket,
        tools.comment_on_existing_ticket,
        tools.cancel_ticket,
        tools.end_call,
      ],
      turnHandling: TURN_HANDLING,
    });
  }
}

/**
 * Reads the summary back and waits for a clear yes.
 *
 * `create_ticket` lives only here, and additionally refuses a draft with no
 * `proposedAt`. Two independent guards, because a prompt instruction alone
 * leaks under pressure.
 */
export class ConfirmAgent extends voice.Agent<CallUserData> {
  constructor(instructions: string, tools: ReturnType<typeof makeToolTable>) {
    super({
      instructions,
      tools: [tools.create_ticket, tools.amend_draft, tools.cancel_ticket, tools.end_call],
      turnHandling: TURN_HANDLING,
    });
  }

  /**
   * Speaks the read-back on entry.
   *
   * Rendered by renderReadback from the stored draft rather than generated,
   * so what the caller confirms is exactly what will be filed. Asking the
   * model to summarise its own summary is how the spoken version and the
   * ticket drift apart.
   */
  override async onEnter(): Promise<void> {
    const draft = this.session.userData.draft?.draft;
    if (!draft) return;

    this.session.say(renderReadback(draft));
  }
}

export interface AgentPair {
  intake: IntakeAgent;
  confirm: ConfirmAgent;
  tools: ReturnType<typeof makeToolTable>;
}

/**
 * Builds both agents and closes the handoff cycle between them.
 *
 * The confirmation agent gets the same caller context as intake: it has to be
 * able to answer a question during the read-back without asking who it is
 * speaking to.
 */
export function createAgents(userData: CallUserData): AgentPair {
  const instructions = buildSystemPrompt(userData.profile, userData.schema);
  const tools = buildTools();

  const intake = new IntakeAgent(instructions, tools);
  const confirm = new ConfirmAgent(
    `${instructions}\n\n${CONFIRM_ADDENDUM}`,
    tools,
  );

  (tools as unknown as { __register: (a: { intake: voice.Agent; confirm: voice.Agent }) => void })
    .__register({ intake, confirm });

  return { intake, confirm, tools };
}

const CONFIRM_ADDENDUM = [
  '## You are now confirming',
  'The summary has just been read out to the caller. Your only job is to find out',
  'whether they agree to it.',
  '',
  'If they clearly agree, call create_ticket. If they correct something, call',
  'amend_draft with what they said was different. If they no longer want a ticket,',
  'call cancel_ticket.',
  '',
  'Anything unclear - "uh", "hmm", silence, a question - is NOT agreement. Ask again,',
  'in one short sentence. Never call create_ticket on an ambiguous answer.',
  '',
  'Right now you hold only create_ticket, amend_draft, cancel_ticket and end_call.',
  'The instructions above name others, because they are the same instructions intake',
  'was given. Do not reach for one you do not have and do not tell the caller a tool',
  'is missing: anything that needs more detail gathered goes through amend_draft,',
  'which hands the call back for exactly that.',
].join('\n');

export { TURN_HANDLING, TTS_TEXT_TRANSFORMS };
