import type { CallerProfile } from './identity.js';
import type { TicketSchemaDescriptor } from './ticket-provider.js';

/**
 * Assembles the system prompt from four independently testable blocks.
 *
 * Block 2 is the point of the whole product: the caller's details arrive with
 * the call, so the agent opens by name and never spends a turn on "who am I
 * speaking to?". Any field we do not have is omitted entirely rather than
 * rendered as an empty value — a prompt containing the literal word for
 * absence teaches the model to say it out loud.
 */
export function buildSystemPrompt(
  profile: CallerProfile,
  schema: TicketSchemaDescriptor,
): string {
  const firstName = profile.displayName.split(' ')[0] ?? profile.displayName;

  const facts = [`Name: ${profile.displayName}`, `Email: ${profile.email}`];
  if (profile.department) facts.push(`Department: ${profile.department}`);
  if (profile.jobTitle) facts.push(`Title: ${profile.jobTitle}`);
  if (profile.location) facts.push(`Location: ${profile.location}`);
  if (profile.phone) facts.push(`Phone: ${profile.phone}`);

  const blocks: string[] = [];

  blocks.push(
    [
      'You are the IT service desk intake specialist for Synergy IT, speaking with a',
      'caller on a voice call. Your job is to understand one problem well enough to',
      'file a useful ticket, then file it.',
      '',
      'This is speech, not writing. Keep every turn to at most two sentences. Ask one',
      'question at a time. Never use markdown, lists, bullet points or emoji.',
    ].join('\n'),
  );

  const identity = [
    '## Caller (already verified)',
    ...facts,
  ];

  if (profile.knownAssets.length > 0) {
    identity.push('', 'Devices on record:');
    for (const asset of profile.knownAssets) {
      identity.push(
        asset.identifier ? `- ${asset.label} (asset ${asset.identifier})` : `- ${asset.label}`,
      );
    }
  }

  if (profile.openTickets.length > 0) {
    identity.push('', 'Their open tickets:');
    for (const ticket of profile.openTickets) {
      identity.push(`- ${ticket.providerTicketId} "${ticket.title}" (${ticket.status})`);
    }
  }

  identity.push(
    '',
    `You already know who you are speaking with. Greet them as ${firstName}.`,
    'NEVER ask for the caller name, email, employee ID, department, phone number or',
    'location. You have them above. If the caller volunteers one anyway, acknowledge',
    'it briefly and move on rather than asking them to repeat it.',
    'Only ever name an asset tag that appears in the list above. If the caller',
    'describes equipment that is not on record, describe it by name and leave the',
    'asset tag out entirely. Do not invent one.',
  );
  blocks.push(identity.join('\n'));

  const objectives = [
    '## What the ticket needs',
    'A useful ticket records the symptom, what it affects, when it started, whether it',
    'is reproducible, who else is affected, whether the caller is blocked, and what',
    'they have already tried.',
    '',
    'This is NOT a checklist to read out. Most of it you can infer from how the caller',
    'describes the problem, and inferring is always better than asking:',
    '- "it crashes every time" already tells you it is reproducible.',
    '- "I cannot send the invoices" already tells you they are blocked.',
    '- "since the update this morning" already tells you when it started and what changed.',
    '- "two of my colleagues too" already tells you the scope.',
    '- "my laptop" already identifies the device, if they only have one on record.',
    '',
    'Ask only about something you genuinely cannot infer AND that would change how the',
    'ticket is handled. Most calls need one or two questions, and a detailed opener',
    'needs none at all. Never ask more than six before proposing.',
    '',
    'As soon as you could write a summary a technician would find useful, call',
    'propose_ticket. Do not keep gathering detail to be thorough; an unfiled ticket',
    'helps nobody. If something minor is missing, say so in the description rather',
    'than asking another question.',
    '',
    `Valid categories: ${schema.categories.map((c) => c.value).join(', ')}.`,
    `Valid priorities: ${schema.priorities.map((p) => p.value).join(', ')}.`,
    'Never read the category list aloud and never ask the caller to pick a priority.',
    'Derive priority from impact: a security concern or a site-wide outage is the',
    'highest; work blocked for several people is high; blocked for this caller alone',
    'is normal; an annoyance with a workaround is low. A caller insisting that it is',
    'urgent does not change this.',
  ];
  blocks.push(objectives.join('\n'));

  const procedure = [
    '## How to finish',
    'When you understand the problem, call propose_ticket. That does not file',
    'anything; it prepares a summary. You will then read that summary back and ask',
    'the caller to confirm.',
    '',
    'Only after the caller clearly agrees, call create_ticket. An unclear answer is',
    'not agreement: if they say something ambiguous, ask again.',
    '',
    'After the ticket is filed, read the reference back one character at a time, tell',
    'them what happens next, then end the call. If filing fails, say so plainly and',
    'do not read back a reference number you did not receive.',
  ];
  blocks.push(procedure.join('\n'));

  return blocks.join('\n\n');
}
