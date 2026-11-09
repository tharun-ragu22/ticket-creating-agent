import { describe, it, expect } from 'vitest';
import { TICKET_EVENT_TOPIC } from '../call-events.js';
import { initialCallTicketState, ticketEventReducer } from './ticket-event-reducer.js';

const DRAFT = {
  title: 'Outlook will not open since this mornings update',
  description:
    'Outlook crashes on launch since the update this morning. The caller cannot send the invoice run, and two colleagues on the team report the same thing.',
  category: 'software',
  priority: 'high',
  affectedAsset: { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
  impact: { scope: 'team', usersAffected: 3, workBlocked: true },
  troubleshootingTried: ['restarted the laptop'],
};

const TICKET = {
  ...DRAFT,
  id: 'tkt_1',
  providerTicketId: 'SI-10432',
  providerName: 'demo',
  status: 'open',
  url: null,
  reporter: {
    subject: 'priya',
    email: 'priya.raman@synergyit.example',
    displayName: 'Priya Raman',
    department: 'Finance',
    jobTitle: 'AP Specialist',
    location: 'Toronto HQ, 4th floor',
    phone: '+1-416-555-0134',
  },
  source: {
    channel: 'voice',
    sessionId: 'job_1',
    roomName: 'call-priya-1',
    startedAt: '2026-11-06T10:00:00.000Z',
  },
  transcriptRef: null,
  tags: [],
  providerExtras: {},
  createdAt: '2026-11-06T10:02:00.000Z',
  updatedAt: '2026-11-06T10:02:00.000Z',
  comments: [],
};

const text = (value: unknown): string => JSON.stringify(value);

describe('ticketEventReducer', () => {
  it('starts with nothing to show', () => {
    expect(initialCallTicketState).toMatchObject({ draft: null, ticket: null, failure: null });
  });

  it('shows the draft when the agent proposes one', () => {
    const next = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_draft', draft: DRAFT }));

    expect(next.draft?.title).toBe(DRAFT.title);
    expect(next.ticket).toBeNull();
  });

  /** The case from the plan: draft then created, card ends on the real reference. */
  it('replaces the draft with the filed ticket and its reference', () => {
    const drafted = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_draft', draft: DRAFT }));
    const created = ticketEventReducer(drafted, text({ kind: 'ticket_created', ticket: TICKET }));

    expect(created.ticket?.providerTicketId).toBe('SI-10432');
    expect(created.failure).toBeNull();
  });

  it('keeps the draft visible after a failure, so the call can be retried', () => {
    const drafted = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_draft', draft: DRAFT }));
    const failed = ticketEventReducer(drafted, text({ kind: 'ticket_failed', reason: 'provider unreachable' }));

    expect(failed.failure).toBe('provider unreachable');
    expect(failed.draft?.title).toBe(DRAFT.title);
    expect(failed.ticket).toBeNull();
  });

  it('clears an earlier failure once a ticket is filed', () => {
    const failed = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_failed', reason: 'timeout' }));
    const created = ticketEventReducer(failed, text({ kind: 'ticket_created', ticket: TICKET }));

    expect(created.failure).toBeNull();
  });

  it('reflects an amended draft rather than stacking a second card', () => {
    const first = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_draft', draft: DRAFT }));
    const amended = ticketEventReducer(
      first,
      text({
        kind: 'ticket_draft',
        draft: { ...DRAFT, title: 'Fourth floor printer jams on every duplex job', category: 'printing' },
      }),
    );

    expect(amended.draft?.category).toBe('printing');
  });

  /*
   * The correction window. The agent drops the draft the moment the caller
   * corrects it, and the re-proposal is several turns away — so without this
   * the phone shows the corrected-away summary as if it still stood.
   */
  describe('a draft the agent has thrown away', () => {
    const drafted = ticketEventReducer(
      initialCallTicketState,
      text({ kind: 'ticket_draft', draft: DRAFT }),
    );

    it('marks it as being corrected rather than leaving it looking current', () => {
      const dropped = ticketEventReducer(
        drafted,
        text({ kind: 'ticket_draft_dropped', reason: 'amended' }),
      );

      expect(dropped.amending).toBe(true);
      // Still on screen: a card that vanishes mid-call reads as a crash.
      expect(dropped.draft?.title).toBe(DRAFT.title);
    });

    it('clears the flag when the corrected draft arrives', () => {
      const dropped = ticketEventReducer(
        drafted,
        text({ kind: 'ticket_draft_dropped', reason: 'amended' }),
      );
      const reproposed = ticketEventReducer(
        dropped,
        text({ kind: 'ticket_draft', draft: { ...DRAFT, title: 'The printer, not the laptop, drops off' } }),
      );

      expect(reproposed.amending).toBe(false);
      expect(reproposed.draft?.title).toBe('The printer, not the laptop, drops off');
    });

    it('takes the card away on a cancellation, since there is no ticket coming', () => {
      const cancelled = ticketEventReducer(
        drafted,
        text({ kind: 'ticket_draft_dropped', reason: 'cancelled' }),
      );

      expect(cancelled).toMatchObject({ draft: null, ticket: null, amending: false });
    });

    /*
     * A second problem cancelled on a call that already filed one. The
     * reference the caller wrote down must not disappear with it.
     */
    it('keeps a ticket already filed on this call when a later draft is cancelled', () => {
      const filed = ticketEventReducer(drafted, text({ kind: 'ticket_created', ticket: TICKET }));
      const cancelled = ticketEventReducer(
        filed,
        text({ kind: 'ticket_draft_dropped', reason: 'cancelled' }),
      );

      expect(cancelled.ticket?.providerTicketId).toBe('SI-10432');
      expect(cancelled.draft).toBeNull();
    });

    it('ignores a reason it does not recognise, like any malformed frame', () => {
      const unchanged = ticketEventReducer(
        drafted,
        text({ kind: 'ticket_draft_dropped', reason: 'because' }),
      );

      expect(unchanged).toBe(drafted);
    });
  });

  /**
   * The reducer is fed by a network topic, so malformed input is expected
   * rather than exceptional. A thrown error here would unmount the call screen
   * mid-call, which is far worse than ignoring a bad frame.
   */
  describe('malformed input is ignored, never thrown', () => {
    const cases: [string, string][] = [
      ['not json at all', 'half a sentence'],
      ['json but not an object', '42'],
      ['an unknown kind', text({ kind: 'ticket_shredded' })],
      ['a draft that fails validation', text({ kind: 'ticket_draft', draft: { title: 'short' } })],
      ['a created event with no ticket', text({ kind: 'ticket_created' })],
      ['null', 'null'],
      ['empty', ''],
    ];

    for (const [name, payload] of cases) {
      it(`ignores ${name}`, () => {
        const before = ticketEventReducer(initialCallTicketState, text({ kind: 'ticket_draft', draft: DRAFT }));
        const after = ticketEventReducer(before, payload);

        expect(after).toBe(before);
      });
    }
  });

  it('is exported alongside the topic it consumes', () => {
    expect(TICKET_EVENT_TOPIC).toBe('tca.ticket');
  });
});
