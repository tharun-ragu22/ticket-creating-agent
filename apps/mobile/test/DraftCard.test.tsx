import { fireEvent, render } from '@testing-library/react-native';
import { initialCallTicketState, type CallTicketState, type Ticket } from '@tca/contracts';
import { DraftCard } from '../src/components/DraftCard';

const DRAFT = {
  title: 'Laptop keeps dropping off the wifi',
  description:
    'The caller loses wifi every few minutes since this morning and cannot stay on a call.',
  category: 'network' as const,
  priority: 'normal' as const,
  affectedAsset: { kind: 'laptop' as const, label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
  impact: { scope: 'self' as const, usersAffected: 1, workBlocked: false },
  troubleshootingTried: [],
};

const TICKET: Ticket = {
  ...DRAFT,
  id: 'tkt_1',
  providerTicketId: 'SI-10401',
  providerName: 'demo',
  status: 'new',
  url: null,
  reporter: {
    subject: 'priya',
    displayName: 'Priya Raman',
    email: 'priya.raman@synergyit.example',
    department: 'Finance',
    jobTitle: 'AP Specialist',
    location: 'Toronto HQ',
    phone: null,
  },
  source: {
    channel: 'voice',
    sessionId: 'sess_1',
    roomName: 'call-priya',
    startedAt: '2026-11-09T09:00:00.000Z',
  },
  transcriptRef: null,
  tags: [],
  providerExtras: {},
  createdAt: '2026-11-09T09:02:00.000Z',
  updatedAt: '2026-11-09T09:02:00.000Z',
  comments: [],
};

const state = (over: Partial<CallTicketState>): CallTicketState => ({
  ...initialCallTicketState,
  ...over,
});

/*
 * The first render in this file pays React Native's module initialisation,
 * which on the container's 9p mount costs more than jest's 5s default on its
 * own. The suite itself runs in milliseconds once that is paid.
 */
jest.setTimeout(30_000);

/*
 * `await render(...)`: RNTL 14 made render async along with renderHook. A
 * forgotten await gives "view.getByLabelText is not a function", which reads
 * like a broken import. fireEvent rather than userEvent for the same reason
 * the repo keeps these tests small: userEvent's first press costs more than
 * jest's 5s default on this filesystem, and nothing here tests gesture detail.
 */
describe('DraftCard', () => {
  it('shows nothing before the agent has proposed anything', async () => {
    const view = await render(<DraftCard state={initialCallTicketState} />);

    expect(view.queryByText('DRAFT')).toBeNull();
  });

  it('labels the narrative the way the caller would ask for it', async () => {
    const view = await render(<DraftCard state={state({ draft: DRAFT })} />);
    await fireEvent.press(view.getByLabelText('Expand ticket details'));

    expect(view.getByText('What happened')).toBeTruthy();
    expect(view.getByText(DRAFT.description)).toBeTruthy();
  });

  /*
   * The phone's half of the correction bug. The agent drops the draft the
   * moment the caller corrects it and re-proposes several turns later; in that
   * window the card showed the corrected-away summary as if it still stood.
   */
  describe('while a correction is being gathered', () => {
    it('says so instead of presenting the old summary as current', async () => {
      const view = await render(<DraftCard state={state({ draft: DRAFT, amending: true })} />);

      expect(view.getByText('UPDATING')).toBeTruthy();
      expect(view.getByText('Updating this with your correction…')).toBeTruthy();
    });

    it('goes back to a plain draft once the corrected one arrives', async () => {
      const view = await render(<DraftCard state={state({ draft: DRAFT })} />);

      expect(view.getByText('DRAFT')).toBeTruthy();
      expect(view.queryByText('Updating this with your correction…')).toBeNull();
    });
  });

  /* A filed ticket cannot be amended, so anything added later is a comment. */
  it('shows what was added after filing, not just the original summary', async () => {
    const commented: Ticket = {
      ...TICKET,
      comments: [
        {
          id: 'cmt_1',
          authorSubject: 'priya',
          body: 'Also affects the scanner on the same floor.',
          createdAt: '2026-11-09T09:04:00.000Z',
        },
      ],
    };

    const view = await render(<DraftCard state={state({ ticket: commented })} />);
    await fireEvent.press(view.getByLabelText('Expand ticket details'));

    expect(view.getByText('Added since')).toBeTruthy();
    expect(view.getByText('Also affects the scanner on the same floor.')).toBeTruthy();
  });

  it('leaves the addition out when there is none', async () => {
    const view = await render(<DraftCard state={state({ ticket: TICKET })} />);
    await fireEvent.press(view.getByLabelText('Expand ticket details'));

    expect(view.getByText('SI-10401')).toBeTruthy();
    expect(view.queryByText('Added since')).toBeNull();
  });
});
