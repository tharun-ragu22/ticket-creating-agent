import { inference, initializeLogger, voice } from '@livekit/agents';
import { createAgents } from '@tca/agent/agents';
import { createCallUserData, type CallUserData } from '@tca/agent/state';
import { asksForIdentity, type NeverAsk, type TicketCategory, type TicketPriority } from '@tca/contracts';
import type { EvalCase } from './case.js';
import { checkTicket, checkTools, countQuestions } from './checks.js';
import { CALLERS, EVAL_SCHEMA } from './fixtures.js';
import { EvalTicketProvider, EvalTranscript, RecordingEvents, callSourceFor } from './harness.js';
import type { CaseOutcome } from './score.js';

initializeLogger({ pretty: false, level: 'error' });

export interface RunnerOptions {
  /**
   * The agent's model. This must be the PRODUCTION model, not the small cheap
   * one used for judging — a scored run exists to tell you how the thing you
   * ship behaves. An earlier version of this ran the agent on EVAL_LLM_MODEL
   * and reported 15/53, almost all of it the small model asking too many
   * questions to ever reach a proposal.
   */
  model: string;
  /** Model used only for judged intents; may differ from the agent's. */
  judgeModel?: string;
}

export interface Runner {
  run(testCase: EvalCase): Promise<CaseOutcome>;
}

export function createRunner(options: RunnerOptions): Runner {
  return {
    async run(testCase: EvalCase): Promise<CaseOutcome> {
      const provider = new EvalTicketProvider();
      const events = new RecordingEvents();

      const userData: CallUserData = createCallUserData({
        profile: CALLERS[testCase.caller],
        source: callSourceFor(testCase.id),
        schema: EVAL_SCHEMA,
        tickets: provider,
        events,
        transcript: new EvalTranscript(),
      });

      // EV-ROB-07 is the one case whose point is that filing fails.
      if (testCase.id === 'EV-ROB-07') {
        provider.failWith = new Error('simulated upstream failure');
      }

      const { intake, confirm } = createAgents(userData);
      const session = new voice.AgentSession<CallUserData>({
        llm: new inference.LLM({ model: options.model }),
        userData,
        turnDetection: 'manual',
        ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
      });

      const toolCalls: string[] = [];
      /** Intake speech: everything said before propose_ticket fired. */
      const spoken: string[] = [];
      /** The read-back and confirmation turns, which are not intake questions. */
      const spokenAfterProposal: string[] = [];
      let proposed = false;

      try {
        await session.start({ agent: intake });

        /**
         * Collects tool calls and speech, splitting the speech at the moment
         * propose_ticket fires.
         *
         * The budget in the spec is "questions asked BEFORE propose_ticket",
         * and the read-back itself ends with "Shall I create the ticket?".
         * Counting that against the intake budget made a correct conversation
         * look like one question over, which is how a measurement artifact
         * gets mistaken for a prompt problem.
         */
        const collect = (result: { events: readonly unknown[] }): void => {
          for (const event of result.events) {
            const e = event as {
              type?: string;
              item?: { role?: string; textContent?: string; name?: string };
            };

            if (e.type === 'function_call' && e.item?.name) {
              toolCalls.push(e.item.name);
              if (e.item.name === 'propose_ticket') proposed = true;
            }

            if (e.type === 'message' && e.item?.role === 'assistant') {
              (proposed ? spokenAfterProposal : spoken).push(e.item.textContent ?? '');
            }
          }
        };

        let wentQuiet = false;
        for (const turn of testCase.turns) {
          collect(await session.run({ userInput: turn.user }).wait());

          // A silent caller is the end of the call, not another prompt.
          if (turn.silenceAfter !== undefined) {
            wentQuiet = true;
            break;
          }
        }

        /**
         * Bounded continuation.
         *
         * A case's turns are the information the caller has, not a prediction
         * of how many questions the agent will ask. When a case expects a
         * ticket and the scripted turns ran out before one appeared, nudge to
         * a close rather than scoring a harness artifact as an agent failure.
         * The question budget still bounds it, so an agent that genuinely
         * interrogates forever still fails EV-Q-03.
         */
        const wantsTicket =
          testCase.expect.toolsCalled.includes('create_ticket') ||
          (testCase.expect.ticket !== undefined &&
            !testCase.expect.toolsNotCalled.includes('create_ticket'));

        if (wantsTicket && !wentQuiet) {
          const closers = [
            'That is everything I know about it.',
            'Yes, please go ahead and log it.',
            'Yes, that is correct. Please create the ticket.',
          ];

          for (const userInput of closers) {
            if (provider.ticket) break;
            if (countQuestions(spoken) > testCase.expect.maxQuestions) break;
            collect(await session.run({ userInput }).wait());
          }
        }
      } finally {
        await session.close().catch(() => undefined);
      }

      return assess(testCase, {
        toolCalls,
        spoken,
        spokenAfterProposal,
        provider,
        confirmAgentUsed: confirm !== undefined,
      });
    },
  };
}

interface Observed {
  toolCalls: string[];
  spoken: string[];
  spokenAfterProposal: string[];
  provider: EvalTicketProvider;
  confirmAgentUsed: boolean;
}

/** Turns what happened into a scored outcome. */
function assess(testCase: EvalCase, observed: Observed): CaseOutcome {
  const { toolCalls, spoken, spokenAfterProposal, provider } = observed;
  // Identity may not be asked for at any point, read-back included.
  const text = [...spoken, ...spokenAfterProposal].join('\n');
  const ticket = provider.ticket;

  const failures: string[] = [
    ...checkTools(toolCalls, {
      toolsCalled: testCase.expect.toolsCalled,
      toolsNotCalled: testCase.expect.toolsNotCalled,
      toolCallCounts: testCase.expect.toolCallCounts,
    }),
  ];

  if (testCase.expect.ticket) {
    failures.push(...checkTicket(ticket, testCase.expect.ticket));
  }

  const identityAsked = testCase.expect.neverAsks.length > 0
    ? asksForIdentity(text).filter((f) => testCase.expect.neverAsks.includes(f))
    : [];
  for (const field of identityAsked) {
    failures.push(`asked the caller for their ${field}, which it already had`);
  }

  const questionsAsked = countQuestions(spoken);
  if (questionsAsked > testCase.expect.maxQuestions) {
    failures.push(`asked ${questionsAsked} questions, budget is ${testCase.expect.maxQuestions}`);
  }

  /**
   * A ticket that exists without propose_ticket having fired is the
   * confirmation protocol having been bypassed. The tools make that
   * structurally impossible, so this is a check on the check.
   */
  const createdWithoutConfirmation =
    ticket !== null && !toolCalls.includes('propose_ticket');
  if (createdWithoutConfirmation) {
    failures.push('a ticket exists but propose_ticket never fired');
  }

  const expectedField = (path: string): unknown => testCase.expect.ticket?.fields[path];

  return {
    id: testCase.id,
    group: testCase.group,
    passed: failures.length === 0,
    failures,

    identityAsked: identityAsked as NeverAsk[],
    questionsAsked,

    reporterSubject: ticket?.reporter.subject ?? null,
    expectedReporterSubject: testCase.caller,

    fabricatedAssetIdentifier: isFabricated(testCase, ticket),
    createdWithoutConfirmation,

    expectedCategory: (expectedField('category') as TicketCategory | undefined) ?? null,
    actualCategory: ticket?.category ?? null,
    expectedPriority: (expectedField('priority') as TicketPriority | undefined) ?? null,
    actualPriority: ticket?.priority ?? null,
  };
}

/**
 * Whether the agent named an asset tag the caller does not own.
 *
 * Checked against the fixture rather than against the case's expectations, so
 * it catches a fabrication in any case, not only the four that look for one.
 */
function isFabricated(testCase: EvalCase, ticket: { affectedAsset?: { identifier: string | null } | null } | null): boolean {
  const identifier = ticket?.affectedAsset?.identifier;
  if (!identifier) return false;

  return !CALLERS[testCase.caller].knownAssets.some((a) => a.identifier === identifier);
}
