import type { Room } from '@livekit/rtc-node';
import {
  CallEvent,
  TICKET_EVENT_TOPIC,
  type CreateTranscriptInput,
  type TranscriptRef,
  type TranscriptTurn,
} from '@tca/contracts';
import type { CallEventSink, TranscriptRecorder } from './state.js';

/**
 * Pushes structured payloads to the app over a text stream.
 *
 * `sendText` on a custom topic rather than publishData: publishData has size
 * ceilings a ticket payload can exceed, and the Node SDK spells the option
 * `destination_identities` while the browser SDK uses `destinationIdentities`
 * — a cross-SDK trap with no error when you get it wrong.
 */
export class RoomEventSink implements CallEventSink {
  constructor(private readonly room: Room) {}

  async publish(event: CallEvent): Promise<void> {
    await this.room.localParticipant?.sendText(JSON.stringify(CallEvent.parse(event)), {
      topic: TICKET_EVENT_TOPIC,
    });
  }
}

/** Discards events when there is no room, as in console mode. */
export class NullEventSink implements CallEventSink {
  readonly published: CallEvent[] = [];
  async publish(event: CallEvent): Promise<void> {
    this.published.push(event);
  }
}

export interface TranscriptPoster {
  (input: CreateTranscriptInput): Promise<TranscriptRef>;
}

/**
 * Collects the call's turns and persists them when a ticket is filed.
 *
 * Posted at filing time rather than streamed, because a transcript is only
 * useful attached to something — and a call that produces no ticket produces
 * no transcript to store.
 */
export class ApiTranscriptRecorder implements TranscriptRecorder {
  readonly turns: TranscriptTurn[] = [];

  constructor(
    private readonly post: TranscriptPoster,
    private readonly meta: { roomName: string; sessionId: string; callerSubject: string },
  ) {}

  record(turn: TranscriptTurn): void {
    this.turns.push(turn);
  }

  async save(): Promise<TranscriptRef | null> {
    if (this.turns.length === 0) return null;

    return this.post({
      roomName: this.meta.roomName,
      sessionId: this.meta.sessionId,
      callerSubject: this.meta.callerSubject,
      turns: [...this.turns],
    });
  }
}
