import { z } from 'zod';
import { ProposeTicketToolInput, Ticket } from './ticket.js';

/** Topic for structured agent-to-app payloads. Transcripts use lk.transcription. */
export const TICKET_EVENT_TOPIC = 'tca.ticket';

export const TicketDraftEvent = z.object({
  kind: z.literal('ticket_draft'),
  draft: ProposeTicketToolInput,
});

/**
 * The draft the app is showing no longer exists.
 *
 * Both amend_draft and cancel_ticket throw the stored draft away, and until
 * this event existed neither told the app. The phone went on showing the
 * superseded summary — so a caller who said "no, it is the printer, not the
 * laptop" watched the agent agree while the card still read "laptop", which
 * reads as the correction having been lost.
 */
export const TicketDraftDroppedEvent = z.object({
  kind: z.literal('ticket_draft_dropped'),
  reason: z.enum(['amended', 'cancelled']),
});

export const TicketCreatedEvent = z.object({
  kind: z.literal('ticket_created'),
  ticket: Ticket,
});

export const TicketFailedEvent = z.object({
  kind: z.literal('ticket_failed'),
  reason: z.string(),
});

export const CallEvent = z.discriminatedUnion('kind', [
  TicketDraftEvent,
  TicketDraftDroppedEvent,
  TicketCreatedEvent,
  TicketFailedEvent,
]);
export type CallEvent = z.infer<typeof CallEvent>;
