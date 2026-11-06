import { describe, it, expect } from 'vitest';
import {
  asksForIdentity,
  countQuestions,
  readPath,
  checkTicket,
  checkTools,
} from './checks.js';

/**
 * The never-asks check is the deterministic half of a hard-fail metric, so
 * its own behaviour matters more than most. It scans what the agent said for
 * requests for information it already had.
 */
describe('asksForIdentity', () => {
  it.each([
    ['name', "Sorry, what's your name?"],
    ['name', 'Could I take your full name please?'],
    ['email', 'What email address should I use for the ticket?'],
    ['department', 'And which department are you in?'],
    ['department', 'What team do you work for?'],
    ['location', 'Which office are you calling from?'],
    ['location', 'What floor are you on?'],
    ['employee_id', 'Do you have your employee ID handy?'],
    ['phone', 'What is the best phone number to reach you on?'],
  ])('flags a request for %s', (field, text) => {
    expect(asksForIdentity(text)).toContain(field);
  });

  it('does not flag the agent using a name it already knows', () => {
    expect(asksForIdentity("Hi Priya, what's going on with the laptop?")).toEqual([]);
  });

  /** Confirming a detail back is explicitly allowed; asking for it is not. */
  it('does not flag confirming a known detail', () => {
    expect(asksForIdentity('I have you as Priya Raman in Finance at Toronto HQ.')).toEqual([]);
  });

  it('does not flag an unrelated question', () => {
    expect(asksForIdentity('Is that on your ThinkPad or your iPhone?')).toEqual([]);
  });

  it('does not flag asking which device, which is not an identity field', () => {
    expect(asksForIdentity('Which device is it happening on?')).toEqual([]);
  });

  it('only reports fields that were actually asked for', () => {
    expect(asksForIdentity('What department are you in?')).toEqual(['department']);
  });
});

describe('countQuestions', () => {
  it('counts one question per question mark', () => {
    expect(countQuestions(['What is happening?', 'Since when?'])).toBe(2);
  });

  it('counts a compound turn as two, which is what makes EV-Q-04 fail', () => {
    expect(countQuestions(['When did it start? And is anyone else affected?'])).toBe(2);
  });

  it('ignores turns with no question', () => {
    expect(countQuestions(['Okay, I have logged that.', 'Is that right?'])).toBe(1);
  });

  it('is zero for no turns', () => {
    expect(countQuestions([])).toBe(0);
  });
});

describe('readPath', () => {
  const ticket = {
    priority: 'high',
    reporter: { subject: 'priya', department: null },
    impact: { workBlocked: true, scope: 'team' },
    affectedAsset: null,
  };

  it('reads a top-level field', () => {
    expect(readPath(ticket, 'priority')).toBe('high');
  });

  it('reads a nested field', () => {
    expect(readPath(ticket, 'impact.workBlocked')).toBe(true);
  });

  it('distinguishes a null value from a missing path', () => {
    expect(readPath(ticket, 'reporter.department')).toBeNull();
    expect(readPath(ticket, 'reporter.nothing')).toBeUndefined();
  });

  /** affectedAsset is legitimately null, and EV-ASSET-03 asserts on its id. */
  it('returns undefined when walking through a null rather than throwing', () => {
    expect(readPath(ticket, 'affectedAsset.identifier')).toBeUndefined();
  });
});

describe('checkTools', () => {
  it('passes when the required tools fired', () => {
    expect(
      checkTools(['propose_ticket', 'create_ticket'], {
        toolsCalled: ['propose_ticket', 'create_ticket'],
        toolsNotCalled: [],
        toolCallCounts: {},
      }),
    ).toEqual([]);
  });

  it('fails a missing required tool', () => {
    const failures = checkTools(['propose_ticket'], {
      toolsCalled: ['propose_ticket', 'create_ticket'],
      toolsNotCalled: [],
      toolCallCounts: {},
    });
    expect(failures.join(' ')).toMatch(/create_ticket/);
  });

  it('fails a tool that must not have fired', () => {
    const failures = checkTools(['propose_ticket', 'create_ticket'], {
      toolsCalled: [],
      toolsNotCalled: ['create_ticket'],
      toolCallCounts: {},
    });
    expect(failures.join(' ')).toMatch(/create_ticket/);
  });

  /** EV-ROB-03: one ticket, not fifty. A set-based check would pass that. */
  it('fails the wrong number of calls even when the tool is in the called set', () => {
    const failures = checkTools(['create_ticket', 'create_ticket'], {
      toolsCalled: ['create_ticket'],
      toolsNotCalled: [],
      toolCallCounts: { create_ticket: 1 },
    });
    expect(failures.join(' ')).toMatch(/create_ticket.*1.*2|create_ticket.*2/);
  });

  it('accepts an expected count of zero', () => {
    expect(
      checkTools(['propose_ticket'], {
        toolsCalled: [],
        toolsNotCalled: [],
        toolCallCounts: { create_ticket: 0 },
      }),
    ).toEqual([]);
  });
});

describe('checkTicket', () => {
  const ticket = {
    title: 'Outlook will not launch after the morning update',
    description: 'Outlook fails to open since the update. Blocks the invoice run.',
    priority: 'high',
    category: 'software',
    reporter: { subject: 'priya' },
    impact: { workBlocked: true, scope: 'team' },
    affectedAsset: { identifier: 'SYN-LT-2291' },
  };

  it('passes matching fields', () => {
    expect(
      checkTicket(ticket, {
        fields: { priority: 'high', 'impact.workBlocked': true, 'reporter.subject': 'priya' },
        descriptionMentions: ['invoice', 'update'],
        descriptionExcludes: ['printer'],
      }),
    ).toEqual([]);
  });

  it('fails a mismatched field and says what it found', () => {
    const failures = checkTicket(ticket, {
      fields: { priority: 'low' },
      descriptionMentions: [],
      descriptionExcludes: [],
    });
    expect(failures.join(' ')).toMatch(/priority.*low.*high|priority.*high/);
  });

  it('matches an expected null, for an asset not on record', () => {
    expect(
      checkTicket(
        { ...ticket, affectedAsset: { identifier: null } },
        { fields: { 'affectedAsset.identifier': null }, descriptionMentions: [], descriptionExcludes: [] },
      ),
    ).toEqual([]);
  });

  it('matches description mentions case-insensitively', () => {
    expect(
      checkTicket(ticket, {
        fields: {},
        descriptionMentions: ['INVOICE'],
        descriptionExcludes: [],
      }),
    ).toEqual([]);
  });

  it('fails an excluded substring that appears', () => {
    const failures = checkTicket(ticket, {
      fields: {},
      descriptionMentions: [],
      descriptionExcludes: ['invoice'],
    });
    expect(failures.join(' ')).toMatch(/invoice/i);
  });

  /** A case asserting on a ticket that was never filed must fail, not pass. */
  it('fails when no ticket was produced at all', () => {
    const failures = checkTicket(null, {
      fields: { priority: 'high' },
      descriptionMentions: [],
      descriptionExcludes: [],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no ticket/i);
  });
});
