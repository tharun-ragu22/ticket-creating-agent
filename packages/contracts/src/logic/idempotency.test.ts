import { describe, it, expect } from 'vitest';
import { deriveIdempotencyKey } from './idempotency.js';

const base = { roomName: 'room_abc', callerSubject: 'priya', startedAt: '2026-11-05T09:00:00.000Z' };

describe('deriveIdempotencyKey', () => {
  it('is deterministic for the same call, so a worker restart reuses it', () => {
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
  });

  it('differs per room', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(
      deriveIdempotencyKey({ ...base, roomName: 'room_xyz' }),
    );
  });

  it('differs per caller', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(
      deriveIdempotencyKey({ ...base, callerSubject: 'dave' }),
    );
  });

  it('differs per call start time', () => {
    expect(deriveIdempotencyKey(base)).not.toBe(
      deriveIdempotencyKey({ ...base, startedAt: '2026-11-05T10:00:00.000Z' }),
    );
  });

  it('is long enough to satisfy the CreateTicketInput minimum of 16', () => {
    expect(deriveIdempotencyKey(base).length).toBeGreaterThanOrEqual(16);
  });

  it('suffixes a draft sequence so a genuine second ticket gets its own key', () => {
    const first = deriveIdempotencyKey(base);
    const second = deriveIdempotencyKey({ ...base, draftSequence: 2 });
    expect(second).not.toBe(first);
    expect(second.startsWith(first)).toBe(true);
  });
});
