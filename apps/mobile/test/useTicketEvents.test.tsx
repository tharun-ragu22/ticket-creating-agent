import { renderHook, act, waitFor } from '@testing-library/react-native';
import { TICKET_EVENT_TOPIC } from '@tca/contracts';
import { useTicketEvents } from '../src/hooks/useTicketEvents';

const DRAFT = {
  title: 'Outlook will not open since this mornings update',
  description:
    'Outlook crashes on launch since the update this morning. The caller cannot send the invoice run, and two colleagues report the same.',
  category: 'software',
  priority: 'high',
  affectedAsset: { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
  impact: { scope: 'team', usersAffected: 3, workBlocked: true },
  troubleshootingTried: [],
};

type Handler = (reader: { readAll: () => Promise<string> }, info: { identity: string }) => void;

function fakeRoom() {
  const handlers = new Map<string, Handler>();
  return {
    registerTextStreamHandler: (topic: string, handler: Handler) => handlers.set(topic, handler),
    unregisterTextStreamHandler: (topic: string) => handlers.delete(topic),
    /** Simulates the agent pushing a payload on a topic. */
    push: async (topic: string, payload: unknown) => {
      const handler = handlers.get(topic);
      if (!handler) throw new Error(`nothing is listening on ${topic}`);
      handler({ readAll: async () => JSON.stringify(payload) }, { identity: 'agent' });
    },
    get topics() {
      return [...handlers.keys()];
    },
  };
}

describe('useTicketEvents', () => {
  it('listens on the ticket topic once a room exists', async () => {
    const room = fakeRoom();
    await renderHook(() => useTicketEvents(room as never));

    expect(room.topics).toEqual([TICKET_EVENT_TOPIC]);
  });

  it('shows nothing before the agent proposes anything', async () => {
    const { result } = await renderHook(() => useTicketEvents(fakeRoom() as never));

    expect(result.current).toMatchObject({ draft: null, ticket: null, failure: null });
  });

  it('surfaces the draft the agent reads back', async () => {
    const room = fakeRoom();
    const { result } = await renderHook(() => useTicketEvents(room as never));

    await act(async () => {
      await room.push(TICKET_EVENT_TOPIC, { kind: 'ticket_draft', draft: DRAFT });
    });

    await waitFor(() => expect(result.current.draft?.priority).toBe('high'));
  });

  /** A malformed frame must not take the call screen down. */
  it('survives a payload that is not a ticket event', async () => {
    const room = fakeRoom();
    const { result } = await renderHook(() => useTicketEvents(room as never));

    await act(async () => {
      await room.push(TICKET_EVENT_TOPIC, { kind: 'who_knows' });
    });

    expect(result.current.draft).toBeNull();
  });

  it('stops listening when the call screen goes away, so a second call can register', async () => {
    const room = fakeRoom();
    const { unmount } = await renderHook(() => useTicketEvents(room as never));
    await unmount();

    expect(room.topics).toEqual([]);
  });

  it('does nothing at all before a room is connected', async () => {
    const { result } = await renderHook(() => useTicketEvents(undefined));

    expect(result.current).toMatchObject({ draft: null });
  });
});
