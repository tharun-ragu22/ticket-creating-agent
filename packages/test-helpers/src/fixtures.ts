import type { CreateTicketInput, ReporterRef } from '@tca/contracts';

export const PRIYA: ReporterRef = {
  subject: 'priya',
  displayName: 'Priya Raman',
  email: 'priya.raman@synergyit.example',
  department: 'Finance',
  jobTitle: 'AP Specialist',
  location: 'Toronto HQ, 4th floor',
  phone: '+1-416-555-0134',
};

export const DAVE: ReporterRef = {
  subject: 'dave',
  displayName: 'Dave Okonjo',
  email: 'dave.okonjo@synergyit.example',
  department: 'Legal',
  jobTitle: 'Counsel',
  location: 'Toronto HQ, 2nd floor',
  phone: null,
};

let counter = 0;

/** A valid CreateTicketInput with a unique idempotency key unless one is given. */
export function makeCreateTicketInput(
  over: Partial<CreateTicketInput> = {},
): CreateTicketInput {
  counter += 1;
  const n = String(counter).padStart(4, '0');

  return {
    idempotencyKey: `idem-key-${n}-${'0'.repeat(16)}`,
    title: `Outlook will not open after update ${n}`,
    description:
      'Outlook fails to launch since the Windows update this morning. ' +
      'Blocks the invoice run. Restarting the laptop did not help.',
    category: 'software',
    priority: 'high',
    reporter: PRIYA,
    affectedAsset: { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
    impact: { scope: 'team', usersAffected: 3, workBlocked: true },
    troubleshootingTried: ['restarted the laptop'],
    source: {
      channel: 'voice',
      sessionId: `sess_${n}`,
      roomName: `room_${n}`,
      startedAt: '2026-11-05T09:00:00.000Z',
    },
    transcriptRef: null,
    tags: [],
    providerExtras: {},
    ...over,
  };
}
