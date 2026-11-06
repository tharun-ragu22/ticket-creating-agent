import { describe, it, expect } from 'vitest';
import { formatTicketRefForSpeech } from './speech.js';

describe('formatTicketRefForSpeech', () => {
  it('spells the letter prefix and reads digits one at a time', () => {
    expect(formatTicketRefForSpeech('SI-10432')).toBe('S-I one zero four three two');
  });

  it('handles a longer alpha prefix', () => {
    expect(formatTicketRefForSpeech('TCA-77')).toBe('T-C-A seven seven');
  });

  it('handles a digits-only reference', () => {
    expect(formatTicketRefForSpeech('908')).toBe('nine zero eight');
  });

  it('handles a letters-only reference', () => {
    expect(formatTicketRefForSpeech('AB')).toBe('A-B');
  });

  it('uppercases lowercase input', () => {
    expect(formatTicketRefForSpeech('si-1')).toBe('S-I one');
  });

  it('ignores separators other than the alpha/digit boundary', () => {
    expect(formatTicketRefForSpeech('SI_10')).toBe('S-I one zero');
  });

  it('returns an empty string for empty input rather than throwing', () => {
    expect(formatTicketRefForSpeech('')).toBe('');
  });
});
