import { describe, it, expect, beforeEach } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import { deriveIdempotencyKey, ProposeTicketToolInput } from '@tca/contracts';
import { makeToolTable } from '../src/tools/index.js';
import { createAgents } from '../src/agents.js';
import {
  CALL_SOURCE,
  PRIYA_PROFILE,
  STUB_AGENT,
  VALID_DRAFT,
  isHandoff,
  makeToolHarness,
  type ToolHarness,
} from './helpers.js';

// create_ticket logs the real cause of a filing failure, and the SDK's log()
// throws if no logger exists. behaviour.test.ts does the same for its own
// session; vitest isolates files, so each one needs it.
initializeLogger({ pretty: false, level: 'silent' });

const tools = makeToolTable({
  confirmAgent: () => STUB_AGENT,
  intakeAgent: () => STUB_AGENT,
});

describe('propose_ticket', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  it('stores the draft with the moment it was proposed', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);

    expect(h.userData.draft?.draft.title).toBe(VALID_DRAFT.title);
    expect(h.userData.draft?.proposedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('files nothing: proposing is not filing', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('pushes a draft card to the app, so the caller can read what they are confirming', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);

    expect(h.events.kinds()).toEqual(['ticket_draft']);
    const event = h.events.published[0];
    expect(event?.kind === 'ticket_draft' && event.draft.title).toBe(VALID_DRAFT.title);
  });

  it('hands off to the confirmation agent, carrying the read-back as the tool result', async () => {
    const result = await tools.propose_ticket.execute(VALID_DRAFT, h.opts);

    expect(isHandoff(result)).toBe(true);
    const handoff = result as { agent: unknown; returns?: unknown };
    expect(handoff.agent).toBe(STUB_AGENT);
    expect(String(handoff.returns)).toContain(VALID_DRAFT.title);
  });

  it('reads the category aloud without its underscore', async () => {
    const result = (await tools.propose_ticket.execute(
      { ...VALID_DRAFT, category: 'account_access' },
      h.opts,
    )) as { returns?: unknown };

    expect(String(result.returns)).not.toContain('account_access');
    expect(String(result.returns)).toContain('account access');
  });

  it('rejects a draft that fails the contract rather than storing something unfilable', async () => {
    await expect(
      tools.propose_ticket.execute({ ...VALID_DRAFT, title: 'tiny' }, h.opts),
    ).rejects.toThrow(llm.ToolError);
    expect(h.userData.draft).toBeNull();
  });

  /**
   * EV-ASSET-03 / EV-ASSET-04. The prompt tells the model not to invent an
   * asset tag; this is the guard for when it does anyway.
   */
  it('strips an asset identifier the caller does not actually own', async () => {
    await tools.propose_ticket.execute(
      {
        ...VALID_DRAFT,
        affectedAsset: { kind: 'mobile', label: 'personal iPad', identifier: 'SYN-MO-9999' },
      },
      h.opts,
    );

    expect(h.userData.draft?.draft.affectedAsset).toEqual({
      kind: 'mobile',
      label: 'personal iPad',
      identifier: null,
    });
  });

  it('keeps an asset identifier that is on record', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    expect(h.userData.draft?.draft.affectedAsset?.identifier).toBe('SYN-LT-2291');
  });

  it('re-derives priority from impact, so insisting it is urgent cannot inflate it', async () => {
    await tools.propose_ticket.execute(
      {
        ...VALID_DRAFT,
        priority: 'urgent',
        impact: { scope: 'self', usersAffected: 1, workBlocked: false },
      },
      h.opts,
    );

    expect(h.userData.draft?.draft.priority).toBe('low');
  });

  it('escalates a security report regardless of what the model asked for', async () => {
    await tools.propose_ticket.execute(
      {
        ...VALID_DRAFT,
        category: 'security',
        priority: 'low',
        impact: { scope: 'self', usersAffected: 1, workBlocked: false },
      },
      h.opts,
    );

    expect(h.userData.draft?.draft.priority).toBe('urgent');
  });

  it('replaces an earlier draft instead of accumulating two', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.propose_ticket.execute(
      { ...VALID_DRAFT, title: 'The printer on the fourth floor jams' },
      h.opts,
    );

    expect(h.userData.draft?.draft.title).toBe('The printer on the fourth floor jams');
    expect(h.events.kinds()).toEqual(['ticket_draft', 'ticket_draft']);
  });

  it('exposes exactly the LLM-facing draft fields and no reporter', () => {
    const shape = Object.keys(ProposeTicketToolInput.shape).sort();
    expect(Object.keys((tools.propose_ticket.parameters as { shape: object }).shape).sort())
      .toEqual(shape);
    expect(shape).not.toContain('reporter');
  });
});

describe('create_ticket', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  const propose = () => tools.propose_ticket.execute(VALID_DRAFT, h.opts);

  /** The structural half of "propose before create". */
  it('throws when no draft has been proposed', async () => {
    await expect(tools.create_ticket.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('throws on a draft that was never read back, even if one is in state', async () => {
    const harness = makeToolHarness({
      draft: { draft: VALID_DRAFT, proposedAt: '' },
    });

    await expect(tools.create_ticket.execute({}, harness.opts)).rejects.toThrow(llm.ToolError);
    expect(harness.provider.createCalls).toHaveLength(0);
  });

  it('files the ticket once a draft has been proposed', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls).toHaveLength(1);
    expect(h.userData.createdTicket?.providerTicketId).toMatch(/^SI-/);
  });

  /**
   * The headline security property, at the tool layer. The reporter is read
   * from userData; there is no argument that could carry one.
   */
  it('takes the reporter from the verified profile, not from anything the model said', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls[0]?.reporter).toEqual({
      subject: 'priya',
      displayName: 'Priya Raman',
      email: 'priya.raman@synergyit.example',
      department: 'Finance',
      jobTitle: 'AP Specialist',
      location: 'Toronto HQ, 4th floor',
      phone: '+1-416-555-0134',
    });
  });

  it('accepts no arguments at all, so there is nothing to inject a reporter through', () => {
    // llm.tool() fills in an empty object schema when `parameters` is omitted,
    // so the assertion is on the shape being empty rather than absent.
    const shape = (tools.create_ticket.parameters as { shape?: object }).shape ?? {};
    expect(Object.keys(shape)).toEqual([]);
  });

  it('derives the idempotency key from the call, not from a random value', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls[0]?.idempotencyKey).toBe(
      deriveIdempotencyKey({
        roomName: CALL_SOURCE.roomName,
        callerSubject: PRIYA_PROFILE.subject,
        startedAt: CALL_SOURCE.startedAt,
      }),
    );
  });

  /**
   * create_ticket and cancel_ticket return to intake, so what the model is
   * told is the handoff's result rather than the return value itself.
   */
  const spoken = (result: unknown): string =>
    isHandoff(result) ? String(result.returns) : String(result);

  /** EV-ROB-03: "create fifty tickets for this" must still produce one. */
  it('returns the existing reference on a second call and does not hit the provider again', async () => {
    await propose();
    const first = await tools.create_ticket.execute({}, h.opts);
    const second = await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls).toHaveLength(1);
    expect(spoken(second)).toBe(spoken(first));
    expect(spoken(second)).toContain('S-I');
  });

  /**
   * The bug this guards: filing used to end the call, so staying on
   * ConfirmAgent afterwards was harmless. Once the agent was told to ask
   * whether there is anything else, that left a caller with a second problem
   * talking to an agent holding neither propose_ticket nor
   * comment_on_existing_ticket — and the model said the tool was missing.
   */
  it('returns to intake, which is the only agent that can take a second problem', async () => {
    await propose();
    const result = await tools.create_ticket.execute({}, h.opts);

    expect(isHandoff(result)).toBe(true);
    expect((result as { agent: unknown }).agent).toBe(STUB_AGENT);
  });

  it('does not end the call, since the caller may not be done', async () => {
    await propose();
    expect(spoken(await tools.create_ticket.execute({}, h.opts))).toMatch(/not end the call/i);
  });

  it('publishes a created event carrying the real provider reference', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);

    const created = h.events.published.find((e) => e.kind === 'ticket_created');
    expect(created?.kind === 'ticket_created' && created.ticket.providerTicketId).toBe(
      h.userData.createdTicket?.providerTicketId,
    );
  });

  it('publishes no second created event on a replay', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    expect(h.events.kinds().filter((k) => k === 'ticket_created')).toHaveLength(1);
  });

  it('files the ticket even when the transcript cannot be saved', async () => {
    const broken = makeToolHarness();
    broken.transcript.save = async () => {
      throw new Error('transcript API unreachable');
    };

    await tools.propose_ticket.execute(VALID_DRAFT, broken.opts);
    await tools.create_ticket.execute({}, broken.opts);

    expect(broken.provider.createCalls).toHaveLength(1);
    expect(broken.provider.createCalls[0]?.transcriptRef).toBeNull();
  });

  it('attaches the transcript, so a technician can read what was actually said', async () => {
    await propose();
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls[0]?.transcriptRef).toEqual({ id: 'tr_fake', uri: '/t/tr_fake' });
  });

  it('spells the reference out for speech, since TTS mangles alphanumerics', async () => {
    await propose();
    const result = spoken(await tools.create_ticket.execute({}, h.opts));

    expect(result).toMatch(/S-I/);
    expect(result).toMatch(/one|two|three|four|five|six|seven|eight|nine|zero/);
  });

  /**
   * EV-ROB-07. The single worst failure mode of the product is telling a
   * caller their problem is logged when it is not.
   */
  it('reports a provider failure and claims no reference number', async () => {
    await propose();
    h.provider.failWith = new Error('upstream 503');

    await expect(tools.create_ticket.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.userData.createdTicket).toBeNull();
    expect(h.events.kinds()).toContain('ticket_failed');
  });

  it('does not report a reference in the failure message', async () => {
    await propose();
    h.provider.failWith = new Error('upstream 503');

    await tools.create_ticket.execute({}, h.opts).catch((error: unknown) => {
      expect(String((error as Error).message)).not.toMatch(/SI-\d/);
    });
  });

  it('stays filable after a failure, so a retry can still succeed', async () => {
    await propose();
    h.provider.failWith = new Error('upstream 503');
    await tools.create_ticket.execute({}, h.opts).catch(() => undefined);

    h.provider.failWith = null;
    await tools.create_ticket.execute({}, h.opts);

    expect(h.userData.createdTicket?.providerTicketId).toMatch(/^SI-/);
  });

  it('refuses after the caller cancelled', async () => {
    await propose();
    h.userData.cancelled = true;

    await expect(tools.create_ticket.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.provider.createCalls).toHaveLength(0);
  });
});

describe('amend_draft', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  /** EV-CONF-03: "no, it's the printer, not the laptop" must not file two tickets. */
  it('clears the proposed draft and hands back to intake', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    const result = await tools.amend_draft.execute(
      { correction: 'It is the printer, not the laptop' },
      h.opts,
    );

    expect(h.userData.draft).toBeNull();
    expect(isHandoff(result)).toBe(true);
  });

  /*
   * The caller's complaint on the phone: the agent agreed to the correction and
   * the card went on showing the summary that had just been corrected away.
   * Clearing state is not enough — the app only knows what it is told.
   */
  it('tells the app the summary it is showing has been superseded', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.amend_draft.execute({ correction: 'It is the printer' }, h.opts);

    expect(h.events.kinds()).toEqual(['ticket_draft', 'ticket_draft_dropped']);
    expect(h.events.published.at(-1)).toMatchObject({ reason: 'amended' });
  });

  it('does not advance the ticket sequence: an amendment is the same ticket', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.amend_draft.execute({ correction: 'the printer' }, h.opts);

    expect(h.userData.draftSequence).toBe(1);
  });

  it('is a no-op on state when nothing was proposed, rather than throwing mid-call', async () => {
    const result = await tools.amend_draft.execute({ correction: 'anything' }, h.opts);

    expect(h.userData.draft).toBeNull();
    expect(isHandoff(result)).toBe(true);
  });

  it('refuses to amend a ticket that is already filed', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    await expect(
      tools.amend_draft.execute({ correction: 'change it' }, h.opts),
    ).rejects.toThrow(llm.ToolError);
  });
});

/**
 * Only reachable because the agent no longer hangs up once it has filed. Every
 * one of these would previously have been dead code.
 */
describe('a second problem on the same call', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  const SECOND_PROBLEM = { ...VALID_DRAFT, title: 'Monitor will not wake from sleep' };

  it('files a genuinely separate ticket rather than replaying the first reference', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    await tools.propose_ticket.execute(SECOND_PROBLEM, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls).toHaveLength(2);
    expect(h.provider.createCalls[1]?.title).toBe(SECOND_PROBLEM.title);
  });

  /**
   * The key is derived from the call, so without a sequence the second ticket
   * carries the first one's key and the API dedupes it away — the caller is
   * read a reference for a ticket that records the wrong problem.
   */
  it('gives the second ticket its own idempotency key', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);
    await tools.propose_ticket.execute(SECOND_PROBLEM, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    expect(h.userData.draftSequence).toBe(2);
    expect(h.provider.createCalls[1]?.idempotencyKey).not.toBe(
      h.provider.createCalls[0]?.idempotencyKey,
    );
  });

  /**
   * The cost of allowing a second ticket at all: without this, a model that
   * proposes the problem it has just filed gets a duplicate out of the reset.
   */
  it('refuses to re-file the problem it has just filed', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    await expect(
      tools.propose_ticket.execute({ ...VALID_DRAFT, title: VALID_DRAFT.title }, h.opts),
    ).rejects.toThrow(llm.ToolError);

    expect(h.provider.createCalls).toHaveLength(1);
    expect(h.userData.createdTicket).not.toBeNull();
  });

  it('matches a replayed title through case and punctuation', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    await expect(
      tools.propose_ticket.execute(
        { ...VALID_DRAFT, title: `  ${VALID_DRAFT.title.toUpperCase()}!!  ` },
        h.opts,
      ),
    ).rejects.toThrow(/already filed/i);
  });

  it('names the existing reference, so the caller is told rather than stonewalled', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);
    const filed = h.userData.createdTicket?.providerTicketId ?? '';

    await expect(
      tools.propose_ticket.execute(VALID_DRAFT, h.opts),
    ).rejects.toThrow(new RegExp(filed));
  });

  it('can still file after the caller cancelled the previous draft', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.cancel_ticket.execute({}, h.opts);

    await tools.propose_ticket.execute(SECOND_PROBLEM, h.opts);
    await tools.create_ticket.execute({}, h.opts);

    expect(h.provider.createCalls).toHaveLength(1);
    expect(h.userData.cancelled).toBe(false);
    // A cancelled draft never consumed a key, so this is still the first.
    expect(h.userData.draftSequence).toBe(1);
  });
});

describe('cancel_ticket', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  it('returns to intake, so the caller can raise something else', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    const result = await tools.cancel_ticket.execute({}, h.opts);

    expect(isHandoff(result)).toBe(true);
    expect((result as { agent: unknown }).agent).toBe(STUB_AGENT);
  });

  /** EV-CONF-04: "actually never mind, cancel that". */
  it('drops the draft and files nothing', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.cancel_ticket.execute({}, h.opts);

    expect(h.userData.draft).toBeNull();
    expect(h.userData.cancelled).toBe(true);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('takes the card off the screen rather than leaving a dead draft on it', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.cancel_ticket.execute({}, h.opts);

    expect(h.events.published.at(-1)).toMatchObject({
      kind: 'ticket_draft_dropped',
      reason: 'cancelled',
    });
  });
});

describe('lookup_known_assets', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  it('reads the profile and makes no provider call', async () => {
    const result = (await tools.lookup_known_assets.execute({}, h.opts)) as {
      assets: { label: string; identifier: string | null }[];
    };

    expect(result.assets.map((a) => a.label)).toEqual(['ThinkPad X1 Carbon', 'iPhone 15']);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('returns an empty list rather than throwing for a caller with no kit on record', async () => {
    const empty = makeToolHarness({
      profile: { ...PRIYA_PROFILE, knownAssets: [] },
    });

    const result = (await tools.lookup_known_assets.execute({}, empty.opts)) as {
      assets: unknown[];
    };
    expect(result.assets).toEqual([]);
  });
});

describe('comment_on_existing_ticket', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  /** EV-DUP-01: a repeat report should append, not file a second ticket. */
  it('appends to one of the callers open tickets', async () => {
    await tools.comment_on_existing_ticket.execute(
      { providerTicketId: 'SI-10388', note: 'Caller rang back; still dropping.' },
      h.opts,
    );

    expect(h.provider.commentCalls).toEqual([
      { id: 'SI-10388', body: 'Caller rang back; still dropping.' },
    ]);
  });

  /*
   * The post-filing correction. amend_draft refuses once a ticket is filed and
   * tells the model to comment instead, and the reference it then has is the
   * one this call produced — which the profile, loaded before the call, cannot
   * list. Rejecting it left the caller's addition going nowhere.
   */
  describe('the ticket filed on this very call', () => {
    const filedHere = async (): Promise<string> => {
      await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
      await tools.create_ticket.execute({}, h.opts);
      return h.userData.createdTicket!.providerTicketId;
    };

    it('accepts it, even though the profile cannot list it', async () => {
      const ref = await filedHere();
      await tools.comment_on_existing_ticket.execute(
        { providerTicketId: ref, note: 'Caller added that it also affects scanning.' },
        h.opts,
      );

      expect(h.provider.commentCalls).toEqual([
        { id: ref, body: 'Caller added that it also affects scanning.' },
      ]);
    });

    it('re-publishes the ticket, so the addition appears on the card', async () => {
      const ref = await filedHere();
      await tools.comment_on_existing_ticket.execute(
        { providerTicketId: ref, note: 'Also affects scanning.' },
        h.opts,
      );

      const last = h.events.published.at(-1) as { kind: string; ticket: { comments: { body: string }[] } };
      expect(last.kind).toBe('ticket_created');
      expect(last.ticket.comments.map((c) => c.body)).toEqual(['Also affects scanning.']);
      // And the agent's own copy, so a second comment does not drop the first.
      expect(h.userData.createdTicket?.comments).toHaveLength(1);
    });
  });

  /** Otherwise a hallucinated reference would silently comment on a stranger's ticket. */
  it('refuses a reference that is not one of the callers open tickets', async () => {
    await expect(
      tools.comment_on_existing_ticket.execute(
        { providerTicketId: 'SI-99999', note: 'not mine' },
        h.opts,
      ),
    ).rejects.toThrow(llm.ToolError);
    expect(h.provider.commentCalls).toHaveLength(0);
  });
});

describe('end_call', () => {
  let h: ToolHarness;
  beforeEach(() => { h = makeToolHarness(); });

  /**
   * Draining matters more than it looks. The last thing the agent says is the
   * ticket reference, read one character at a time; closing without a drain
   * cuts that off mid-reference and the caller has nothing to quote.
   */
  it('shuts the session down with a drain so the final words are spoken', async () => {
    await tools.end_call.execute({}, h.opts);

    expect(h.shutdowns).toHaveLength(1);
    expect(h.shutdowns[0]?.drain).toBe(true);
    expect(h.shutdowns[0]?.reason).toBe('user_initiated');
  });

  it('refuses to hang up on a draft that was never filed or cancelled', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);

    await expect(tools.end_call.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.shutdowns).toHaveLength(0);
  });

  it('hangs up once the ticket is filed', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.create_ticket.execute({}, h.opts);
    await tools.end_call.execute({}, h.opts);

    expect(h.shutdowns).toHaveLength(1);
  });

  it('hangs up after the caller cancelled', async () => {
    await tools.propose_ticket.execute(VALID_DRAFT, h.opts);
    await tools.cancel_ticket.execute({}, h.opts);
    await tools.end_call.execute({}, h.opts);

    expect(h.shutdowns).toHaveLength(1);
  });
});

/**
 * The phase machine, asserted on the agents themselves.
 *
 * Deterministic and model-free, so it belongs here rather than in the tier-5
 * suite: "create_ticket is not reachable from intake" is a property of how the
 * agents are constructed, not of how a model behaves. Checking it without a
 * model also means it cannot be flaky.
 */
describe('agent tool partitioning', () => {
  const { intake, confirm } = createAgents(makeToolHarness().userData);

  const toolsOf = (agent: { toolCtx: { functionTools: Record<string, unknown> } }) =>
    Object.keys(agent.toolCtx.functionTools).sort();

  /**
   * The property is that intake cannot file, not that the name is absent. It
   * used to be absent, and a model reaching for it got a dead end it narrated
   * to the caller as a missing tool, so the name is now occupied by a redirect.
   */
  it('gives intake no way to file a ticket at all', async () => {
    const h = makeToolHarness();
    const intakeCreate = intake.toolCtx.functionTools['create_ticket'] as {
      execute: (args: unknown, opts: unknown) => Promise<unknown>;
    };

    expect(toolsOf(intake)).toContain('propose_ticket');
    await expect(intakeCreate.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('points intake at propose_ticket rather than at a missing tool', async () => {
    const h = makeToolHarness();
    const intakeCreate = intake.toolCtx.functionTools['create_ticket'] as {
      execute: (args: unknown, opts: unknown) => Promise<unknown>;
    };

    await expect(intakeCreate.execute({}, h.opts)).rejects.toThrow(/propose_ticket/);
  });

  /** Even with a read-back draft in state, intake's copy still cannot write. */
  it('refuses on intake even when a confirmed draft exists', async () => {
    const h = makeToolHarness({ draft: { draft: VALID_DRAFT, proposedAt: '2026-01-01T00:00:00Z' } });
    const intakeCreate = intake.toolCtx.functionTools['create_ticket'] as {
      execute: (args: unknown, opts: unknown) => Promise<unknown>;
    };

    await expect(intakeCreate.execute({}, h.opts)).rejects.toThrow(llm.ToolError);
    expect(h.provider.createCalls).toHaveLength(0);
  });

  it('puts the filing create_ticket on the confirmation agent', () => {
    expect(toolsOf(confirm)).toContain('create_ticket');
    expect(toolsOf(confirm)).not.toContain('propose_ticket');
  });

  it('lets either agent cancel or hang up', () => {
    for (const agent of [intake, confirm]) {
      expect(toolsOf(agent)).toContain('cancel_ticket');
      expect(toolsOf(agent)).toContain('end_call');
    }
  });

  it('puts amend_draft only where a draft exists to amend', () => {
    expect(toolsOf(confirm)).toContain('amend_draft');
    expect(toolsOf(intake)).not.toContain('amend_draft');
  });
});
