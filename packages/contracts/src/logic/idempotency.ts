import { createHash } from 'node:crypto';

export interface IdempotencyKeyInput {
  roomName: string;
  callerSubject: string;
  startedAt: string;
  /**
   * Second and subsequent genuine tickets within one call. Omitted (or 1) for
   * the first, so the key stays stable across a worker restart on the same room.
   */
  draftSequence?: number;
}

/**
 * One key per ticket-intent per call, derived rather than random.
 *
 * Being deterministic is the whole point: if the worker restarts mid-call and
 * replays, it recomputes the same key and the API returns the existing ticket
 * instead of filing a duplicate.
 */
export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const base = createHash('sha256')
    .update(`${input.roomName}|${input.callerSubject}|${input.startedAt}`)
    .digest('hex');

  const seq = input.draftSequence;
  return seq !== undefined && seq > 1 ? `${base}:${seq}` : base;
}
