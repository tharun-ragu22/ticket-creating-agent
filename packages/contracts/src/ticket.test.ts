import { describe, it, expect } from 'vitest';
import {
  CreateTicketInput,
  ProposeTicketToolInput,
  TicketCategory,
  TicketPriority,
  ImpactAssessment,
  AffectedAsset,
  Ticket,
  TicketComment,
} from './ticket.js';

const validReporter = {
  subject: 'priya',
  displayName: 'Priya Raman',
  email: 'priya.raman@synergyit.example',
  department: 'Finance',
  jobTitle: 'AP Specialist',
  location: 'Toronto HQ',
  phone: null,
};

const validInput = {
  idempotencyKey: 'a'.repeat(32),
  title: 'Outlook will not open after update',
  description: 'Outlook fails to launch since the Windows update this morning. Blocks invoice run.',
  category: 'software',
  priority: 'high',
  reporter: validReporter,
  affectedAsset: { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
  impact: { scope: 'team', usersAffected: 3, workBlocked: true },
  troubleshootingTried: ['restarted the laptop'],
  source: {
    channel: 'voice',
    sessionId: 'sess_1',
    roomName: 'room_1',
    startedAt: '2026-11-05T09:00:00.000Z',
  },
  transcriptRef: null,
  tags: [],
  providerExtras: {},
};

describe('ProposeTicketToolInput (the LLM-facing schema)', () => {
  // This is the single most important test in the repo: the model must be
  // STRUCTURALLY incapable of deciding who reported a ticket.
  it.each(['reporter', 'source', 'idempotencyKey', 'transcriptRef'])(
    'has no %s key at all',
    (forbidden) => {
      expect(Object.keys(ProposeTicketToolInput.shape)).not.toContain(forbidden);
    },
  );

  it('strips a reporter the model tries to smuggle in', () => {
    const parsed = ProposeTicketToolInput.parse({
      title: 'Wifi keeps dropping in the office',
      description: 'Wifi disconnects every few minutes on the 4th floor since this morning.',
      category: 'network',
      priority: 'high',
      affectedAsset: null,
      impact: { scope: 'team', usersAffected: 4, workBlocked: true },
      troubleshootingTried: [],
      reporter: { subject: 'admin', email: 'admin@synergy' },
    });
    expect(parsed).not.toHaveProperty('reporter');
  });

  it('accepts a null affectedAsset rather than requiring optional', () => {
    expect(() =>
      ProposeTicketToolInput.parse({
        title: 'Desk phone has no dial tone at all',
        description: 'No dial tone on the desk phone since Monday morning, handset is dead.',
        category: 'telephony',
        priority: 'normal',
        affectedAsset: null,
        impact: { scope: 'self', usersAffected: 1, workBlocked: false },
        troubleshootingTried: [],
      }),
    ).not.toThrow();
  });
});

describe('CreateTicketInput', () => {
  it('accepts a fully-formed input', () => {
    expect(() => CreateTicketInput.parse(validInput)).not.toThrow();
  });

  it('rejects a title that is too short to be useful', () => {
    expect(() => CreateTicketInput.parse({ ...validInput, title: 'wifi' })).toThrow();
  });

  it('rejects a description that is too short to help a technician', () => {
    expect(() => CreateTicketInput.parse({ ...validInput, description: 'broken' })).toThrow();
  });

  it('requires an idempotency key of at least 16 characters', () => {
    expect(() => CreateTicketInput.parse({ ...validInput, idempotencyKey: 'short' })).toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => CreateTicketInput.parse({ ...validInput, category: 'teleportation' })).toThrow();
  });

  it('rejects a reporter without an email', () => {
    const { email: _omitted, ...noEmail } = validReporter;
    expect(() => CreateTicketInput.parse({ ...validInput, reporter: noEmail })).toThrow();
  });

  it('defaults troubleshootingTried and tags to empty arrays', () => {
    const { troubleshootingTried: _a, tags: _b, ...rest } = validInput;
    const parsed = CreateTicketInput.parse(rest);
    expect(parsed.troubleshootingTried).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });
});

describe('enums', () => {
  it('exposes the four priorities in escalating order', () => {
    expect(TicketPriority.options).toEqual(['low', 'normal', 'high', 'urgent']);
  });

  it('includes a security category so phishing reports have a home', () => {
    expect(TicketCategory.options).toContain('security');
  });

  it('models impact scope from self up to company', () => {
    expect(ImpactAssessment.shape.scope.options).toEqual(['self', 'team', 'site', 'company']);
  });

  it('allows an asset with no identifier, for kit that is not on record', () => {
    const parsed = AffectedAsset.parse({ kind: 'other', label: 'personal iPad', identifier: null });
    expect(parsed.identifier).toBeNull();
  });
});

describe('Ticket comments', () => {
  it('defaults comments to an empty array, so a fresh ticket has none', () => {
    const parsed = Ticket.parse({
      ...validInput,
      idempotencyKey: undefined,
      id: 't_1',
      providerTicketId: 'SI-10001',
      providerName: 'demo',
      status: 'new',
      url: null,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T09:00:00.000Z',
    });
    expect(parsed.comments).toEqual([]);
  });

  it('accepts comments, which is how a repeat report appends instead of duplicating', () => {
    const parsed = TicketComment.parse({
      id: 'c_1',
      authorSubject: 'priya',
      body: 'Caller reported this again.',
      createdAt: '2026-11-05T10:00:00.000Z',
    });
    expect(parsed.body).toBe('Caller reported this again.');
  });
});
