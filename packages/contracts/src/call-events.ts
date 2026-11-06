import { z } from 'zod';
import { ProposeTicketToolInput, Ticket } from './ticket.js';

/** Topic for structured agent-to-app payloads. Transcripts use lk.transcription. */
export const TICKET_EVENT_TOPIC = 'tca.ticket';

export const TicketDraftEvent = z.object({
  kind: z.literal('ticket_draft'),
  draft: ProposeTicketToolInput,
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
  TicketCreatedEvent,
  TicketFailedEvent,
]);
export type CallEvent = z.infer<typeof CallEvent>;
