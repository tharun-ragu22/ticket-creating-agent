import { CallEvent } from '../call-events.js';
import type { Ticket, TicketDraft } from '../ticket.js';

/**
 * What the call screen knows about the ticket being built.
 *
 * One state for the whole call rather than a list of events: the caller only
 * ever has one ticket in flight, an amendment replaces the draft instead of
 * adding a card, and the filed ticket supersedes the draft entirely.
 */
export interface CallTicketState {
  /** The agent's current proposal, read back for confirmation. */
  readonly draft: TicketDraft | null;
  /** Set once the ticket is actually filed; carries the real reference. */
  readonly ticket: Ticket | null;
  /** Why the last attempt to file failed, if it did. */
  readonly failure: string | null;
}

export const initialCallTicketState: CallTicketState = {
  draft: null,
  ticket: null,
  failure: null,
};

/**
 * Folds one `tca.ticket` payload into the call's ticket state.
 *
 * Takes the raw string off the wire rather than a parsed object so that
 * parsing and validation cannot be skipped by a caller. Anything malformed
 * returns the previous state **by reference**, which both keeps the screen
 * stable and lets React skip the re-render: a bad frame on a network topic is
 * expected, and throwing would unmount the call screen mid-conversation.
 */
export function ticketEventReducer(state: CallTicketState, payload: string): CallTicketState {
  const event = parse(payload);
  if (!event) return state;

  switch (event.kind) {
    case 'ticket_draft':
      // An amendment replaces the proposal and clears a stale failure: the
      // caller is being read back something new.
      return { draft: event.draft, ticket: null, failure: null };

    case 'ticket_created':
      return { draft: state.draft, ticket: event.ticket, failure: null };

    case 'ticket_failed':
      // The draft stays on screen: the call is still live and the caller can
      // ask to try again.
      return { draft: state.draft, ticket: null, failure: event.reason };
  }
}

function parse(payload: string): CallEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = CallEvent.safeParse(json);
  return result.success ? result.data : null;
}
