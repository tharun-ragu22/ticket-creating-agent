import { useEffect, useState } from 'react';
import {
  TICKET_EVENT_TOPIC,
  initialCallTicketState,
  ticketEventReducer,
  type CallTicketState,
} from '@tca/contracts';

/** The subset of Room this hook needs, so it can be tested without one. */
export interface TextStreamRoom {
  registerTextStreamHandler(
    topic: string,
    handler: (reader: { readAll(): Promise<string> }, info: { identity: string }) => void,
  ): void;
  unregisterTextStreamHandler(topic: string): void;
}

/**
 * The ticket as the agent builds it.
 *
 * Text streams rather than data packets, matching RoomEventSink on the agent
 * side: publishData has size ceilings a ticket payload can exceed. The reducer
 * does the validating, so a malformed frame leaves the screen untouched
 * instead of unmounting it mid-call.
 */
export function useTicketEvents(room: TextStreamRoom | undefined): CallTicketState {
  const [state, setState] = useState<CallTicketState>(initialCallTicketState);

  useEffect(() => {
    if (!room) return;

    room.registerTextStreamHandler(TICKET_EVENT_TOPIC, (reader) => {
      void reader
        .readAll()
        .then((payload) => setState((previous) => ticketEventReducer(previous, payload)))
        // A failed read is a dropped frame, not a reason to break the call.
        .catch(() => undefined);
    });

    return () => {
      // Registration is per topic and throws if a second handler is added, so
      // leaving one behind would break the next call in the same room object.
      try {
        room.unregisterTextStreamHandler(TICKET_EVENT_TOPIC);
      } catch {
        // already gone
      }
    };
  }, [room]);

  return state;
}
