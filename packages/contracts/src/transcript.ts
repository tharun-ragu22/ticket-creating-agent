import { z } from 'zod';

export const TranscriptTurn = z.object({
  role: z.enum(['caller', 'agent']),
  text: z.string().min(1),
  at: z.iso.datetime(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurn>;

export const CreateTranscriptInput = z.object({
  roomName: z.string().min(1),
  sessionId: z.string().min(1),
  callerSubject: z.string().min(1),
  turns: z.array(TranscriptTurn).min(1),
});
export type CreateTranscriptInput = z.infer<typeof CreateTranscriptInput>;

export interface StoredTranscript extends CreateTranscriptInput {
  id: string;
  createdAt: string;
}

/**
 * Where a call's turns go.
 *
 * On the interface rather than inline in the agent because the agent writes
 * transcripts and the API stores them — the same shape has to exist on both
 * sides of the HTTP hop, and having it in one place is the reason this repo is
 * a single language.
 */
export interface TranscriptStore {
  create(input: CreateTranscriptInput): Promise<StoredTranscript>;
  get(id: string): Promise<StoredTranscript | null>;
  findByRoom(roomName: string): Promise<StoredTranscript | null>;
}
