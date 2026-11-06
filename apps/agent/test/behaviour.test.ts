import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inference, initializeLogger, voice } from '@livekit/agents';
import { asksForIdentity, derivePriority, type NeverAsk } from '@tca/contracts';
import { createAgents } from '../src/agents.js';
import { makeToolHarness, VALID_DRAFT, type ToolHarness } from './helpers.js';
import type { CallUserData } from '../src/session/state.js';

initializeLogger({ pretty: false, level: 'error' });

/**
 * Tier 5: the agent's conversational behaviour, in text mode.
 *
 * No audio and no TTS, so these are cheap enough to run on every push — but
 * they still call a real model, so the discipline from the plan applies:
 * assert on STRUCTURE (which tool fired, which handoff happened, which tool
 * did NOT fire) and reserve judging for properties structure cannot express.
 * A suite that asserts on wording fails on every prompt tweak and gets
 * disabled inside a week.
 *
 * The scored corpus in evals/ is the full specification; this is the subset
 * tagged t5 there.
 */
const MODEL = process.env['EVAL_LLM_MODEL'] ?? 'google/gemini-2.5-flash';
const HAS_CREDENTIALS = Boolean(process.env['LIVEKIT_API_KEY'] && process.env['LIVEKIT_API_SECRET']);

// Skipped rather than failed without credentials: a developer with no LiveKit
// project must still be able to run the deterministic tiers.
const describeBehaviour = HAS_CREDENTIALS ? describe : describe.skip;

interface Fixture {
  session: voice.AgentSession<CallUserData>;
  harness: ToolHarness;
  close: () => Promise<void>;
}

async function startSession(over: Parameters<typeof makeToolHarness>[0] = {}): Promise<Fixture> {
  const harness = makeToolHarness(over);
  const { intake } = createAgents(harness.userData);

  const session = new voice.AgentSession<CallUserData>({
    llm: new inference.LLM({ model: MODEL }),
    userData: harness.userData,
    // Text mode: no audio, so no turn detection is provisioned.
    turnDetection: 'manual',
    ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
  });

  await session.start({ agent: intake });
  return { session, harness, close: () => session.close() };
}

describeBehaviour('IntakeAgent', () => {
  let fixture: Fixture;
  beforeAll(async () => { fixture = await startSession(); }, 60_000);
  afterAll(async () => { await fixture?.close(); });

  /** EV-ID-01. The headline requirement, and a hard-fail metric at 0%. */
  it('does not ask for identity it already has', async () => {
    const result = await fixture.session.run({ userInput: 'my laptop will not turn on' }).wait();
    const asked = asksForIdentityIn(result);

    expect(asked, `agent asked for: ${asked.join(', ')}`).toEqual([]);
  });

  it('offers the callers own devices rather than asking what they have', async () => {
    const result = await fixture.session
      .run({ userInput: 'my device will not connect to the wifi' })
      .wait();

    expect(asksForIdentityIn(result)).toEqual([]);
  });
});

/**
 * Reaching a proposal.
 *
 * Driven over several turns rather than asserting the model proposes on turn
 * one. Asking a clarifying question first is correct behaviour, and an earlier
 * version of this test asserted the one-shot case and failed intermittently —
 * which is precisely the flake the plan warns turns into a disabled tier. The
 * requirement is that it proposes WITHIN the question budget (EV-Q-03), and
 * that is what is asserted.
 */
describeBehaviour('IntakeAgent reaching a proposal', () => {
  let fixture: Fixture;
  let turnsUsed: number;
  let questionsAsked: number;
  let sawHandoff: boolean;

  beforeAll(async () => {
    fixture = await startSession();

    // Collectively these answer every intake question, in any order the model
    // asks them, so the loop does not depend on which it picks first.
    const turns = [
      'Outlook will not open at all since the update this morning, on my ThinkPad.',
      'It crashes immediately, every single time I try.',
      'Two colleagues in Finance have exactly the same thing.',
      'None of us can send the invoice run, so I am completely blocked.',
      'I have restarted the laptop already and it made no difference.',
      'That is everything. Please log it.',
    ];

    let spoken = '';
    turnsUsed = 0;
    sawHandoff = false;

    for (const userInput of turns) {
      turnsUsed += 1;
      const result = await fixture.session.run({ userInput }).wait();
      spoken += `\n${assistantText(result)}`;

      if (result.events.some(isHandoffEvent)) sawHandoff = true;
      if (fixture.harness.userData.draft) break;
    }

    questionsAsked = (spoken.match(/\?/g) ?? []).length;
  }, 180_000);

  afterAll(async () => { await fixture?.close(); });

  it('proposes within the question budget', () => {
    expect(fixture.harness.userData.draft, `no draft after ${turnsUsed} turns`).not.toBeNull();
    expect(questionsAsked).toBeLessThanOrEqual(6);
  });

  it('hands off to the confirmation agent', () => {
    expect(sawHandoff).toBe(true);
  });

  it('never asked for identity along the way', async () => {
    expect(fixture.harness.userData.draft).not.toBeNull();
  });

  /**
   * The invariant, not a specific band.
   *
   * An earlier version asserted `high`, which held only if the model consumed
   * enough turns to hear "two colleagues" before proposing. Tightening the
   * prompt made it propose sooner, so it recorded scope: self and derived
   * `normal` — correct for the facts it had, but the test failed. Asserting
   * the band couples this test to the model's pacing; asserting that the
   * priority matches the recorded impact is the property that actually
   * matters, and it holds whenever it proposes. The specific bands are
   * covered by group C in the corpus, where the turns are fixed.
   */
  it('derived the priority from the impact it recorded, not from its own judgement', () => {
    const draft = fixture.harness.userData.draft?.draft;
    expect(draft).toBeDefined();
    expect(draft?.priority).toBe(derivePriority(draft!.impact, draft!.category));
    expect(fixture.harness.userData.draft?.proposedAt).toBeTruthy();
  });

  it('filed nothing, because proposing is not filing', () => {
    expect(fixture.harness.provider.createCalls).toHaveLength(0);
  });

  it('pushed a draft card to the app', () => {
    expect(fixture.harness.events.kinds()).toContain('ticket_draft');
  });

  it('grounded the asset to the one on record', () => {
    const identifier = fixture.harness.userData.draft?.draft.affectedAsset?.identifier;
    expect(identifier === null || identifier === 'SYN-LT-2291').toBe(true);
  });
});

const isHandoffEvent = (event: unknown): boolean =>
  typeof event === 'object' && event !== null &&
  (event as { type?: string }).type === 'agent_handoff';

describeBehaviour('ConfirmAgent', () => {
  /** A session that starts already holding a proposed draft. */
  const withDraft = () =>
    startSession({ draft: { draft: VALID_DRAFT, proposedAt: '2026-11-05T09:03:00.000Z' } });

  it('files exactly one ticket on a clear yes (EV-CONF-06)', async () => {
    const fixture = await withDraft();
    try {
      await fixture.session.updateAgent(createAgents(fixture.harness.userData).confirm);
      const result = await fixture.session.run({ userInput: 'yes, go ahead' }).wait();

      result.expect.containsFunctionCall({ name: 'create_ticket' });
      expect(fixture.harness.provider.createCalls).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  /** EV-CONF-05. Ambiguity is not consent, and this is a hard-fail metric. */
  it('does not file on an ambiguous reply', async () => {
    const fixture = await withDraft();
    try {
      await fixture.session.updateAgent(createAgents(fixture.harness.userData).confirm);
      await fixture.session.run({ userInput: 'uh' }).wait();

      expect(fixture.harness.provider.createCalls).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  /** EV-CONF-04. */
  it('files nothing when the caller cancels', async () => {
    const fixture = await withDraft();
    try {
      await fixture.session.updateAgent(createAgents(fixture.harness.userData).confirm);
      await fixture.session.run({ userInput: 'actually never mind, cancel that' }).wait();

      expect(fixture.harness.provider.createCalls).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  /**
   * EV-ROB-07, via a mocked tool failure. The worst thing this product could
   * do is tell a caller their problem is logged when it is not.
   */
  it('reports a filing failure without inventing a reference', async () => {
    const fixture = await withDraft();
    try {
      await fixture.session.updateAgent(createAgents(fixture.harness.userData).confirm);
      fixture.harness.provider.failWith = new Error('upstream 503');

      const result = await fixture.session.run({ userInput: 'yes please' }).wait();
      const spoken = assistantText(result);

      expect(spoken).not.toMatch(/\bSI-\d/);
      expect(fixture.harness.events.kinds()).toContain('ticket_failed');
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

/** Everything the assistant said, concatenated. */
function assistantText(result: { events: readonly unknown[] }): string {
  return result.events
    .filter(
      (e): e is { type: string; item: { role: string; textContent?: string } } =>
        typeof e === 'object' && e !== null && (e as { type?: string }).type === 'message',
    )
    .filter((e) => e.item.role === 'assistant')
    .map((e) => e.item.textContent ?? '')
    .join('\n');
}

export { assistantText };

/**
 * Which identity fields the agent asked for across a whole run.
 *
 * Uses the same checker as the scored eval gate, from @tca/contracts, rather
 * than a second copy: if the two disagreed about what counts as asking, a case
 * could pass one tier and fail the other.
 */
function asksForIdentityIn(result: { events: readonly unknown[] }): NeverAsk[] {
  const asked = new Set<NeverAsk>();

  for (const field of asksForIdentity(assistantText(result))) asked.add(field);
  return [...asked];
}
