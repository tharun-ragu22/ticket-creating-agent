import { describe, it, expect } from 'vitest';
import { derivePriority } from './derive-priority.js';
import type { Impact } from '../ticket.js';

const impact = (over: Partial<Impact> = {}): Impact => ({
  scope: 'self',
  usersAffected: 1,
  workBlocked: false,
  ...over,
});

describe('derivePriority', () => {
  it('returns high when work is blocked and a team is affected', () => {
    expect(derivePriority(impact({ scope: 'team', usersAffected: 3, workBlocked: true }), 'software'))
      .toBe('high');
  });

  it('returns normal when work is blocked for the caller alone', () => {
    expect(derivePriority(impact({ scope: 'self', workBlocked: true }), 'software')).toBe('normal');
  });

  it('returns low when there is a workaround', () => {
    expect(derivePriority(impact({ scope: 'self', workBlocked: false }), 'printing')).toBe('low');
  });

  it('returns urgent for a site-wide outage', () => {
    expect(derivePriority(impact({ scope: 'site', usersAffected: 40, workBlocked: true }), 'network'))
      .toBe('urgent');
  });

  it('returns urgent for a company-wide outage', () => {
    expect(derivePriority(impact({ scope: 'company', workBlocked: true }), 'network')).toBe('urgent');
  });

  it('returns urgent for anything in the security category', () => {
    expect(derivePriority(impact({ scope: 'self', workBlocked: false }), 'security')).toBe('urgent');
  });

  it('escalates a site-wide problem even when nobody is strictly blocked', () => {
    expect(derivePriority(impact({ scope: 'site', workBlocked: false }), 'network')).toBe('urgent');
  });

  // EV-PRI-06: the caller insisting it is urgent must not move the needle.
  // The function takes no "caller urgency" argument at all, which is the point:
  // social pressure cannot reach this decision.
  it('is a pure function of impact and category, with no urgency override', () => {
    expect(derivePriority.length).toBe(2);
    const withWorkaround = impact({ scope: 'self', workBlocked: false });
    expect(derivePriority(withWorkaround, 'software')).toBe('low');
    expect(derivePriority(withWorkaround, 'software')).toBe('low');
  });

  it('treats a team scope without blocking as low rather than high', () => {
    expect(derivePriority(impact({ scope: 'team', usersAffected: 2, workBlocked: false }), 'printing'))
      .toBe('low');
  });
});
