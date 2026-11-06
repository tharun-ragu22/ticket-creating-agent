import { describe, it, expect } from 'vitest';
import { renderReadback } from './readback.js';
import type { TicketDraft } from '../ticket.js';

const draft: TicketDraft = {
  title: 'Outlook will not open after Windows update',
  description: 'Outlook fails to launch since this mornings update. Blocks the invoice run.',
  category: 'software',
  priority: 'high',
  affectedAsset: { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
  impact: { scope: 'team', usersAffected: 3, workBlocked: true },
  troubleshootingTried: ['restarted the laptop'],
};

describe('renderReadback', () => {
  it('states the title', () => {
    expect(renderReadback(draft)).toContain('Outlook will not open after Windows update');
  });

  it('states the priority and category in words a caller understands', () => {
    const spoken = renderReadback(draft);
    expect(spoken).toContain('high');
    expect(spoken).toContain('software');
  });

  it('ends by asking for confirmation', () => {
    expect(renderReadback(draft).trimEnd().endsWith('?')).toBe(true);
  });

  it('contains no markdown, because this is spoken aloud', () => {
    expect(renderReadback(draft)).not.toMatch(/[*_`#|]/);
  });

  it('contains no newlines, because this is one spoken turn', () => {
    expect(renderReadback(draft)).not.toContain('\n');
  });

  it('never leaks the string undefined or null when the asset is absent', () => {
    const spoken = renderReadback({ ...draft, affectedAsset: null });
    expect(spoken).not.toMatch(/undefined|null/);
  });

  it('mentions the affected asset when there is one', () => {
    expect(renderReadback(draft)).toContain('ThinkPad X1 Carbon');
  });

  it('stays short enough to speak without the caller interrupting', () => {
    expect(renderReadback(draft).length).toBeLessThan(320);
  });
});
