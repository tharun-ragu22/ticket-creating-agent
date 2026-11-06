import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt.js';
import type { CallerProfile, TicketSchemaDescriptor } from './index.js';

const profile: CallerProfile = {
  subject: 'priya',
  email: 'priya.raman@synergyit.example',
  tenantId: 'synergy',
  scopes: ['call'],
  displayName: 'Priya Raman',
  department: 'Finance',
  jobTitle: 'AP Specialist',
  location: 'Toronto HQ, 4th floor',
  phone: '+1-416-555-0134',
  managerEmail: null,
  preferredLanguage: 'en',
  knownAssets: [
    { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
    { kind: 'mobile', label: 'iPhone 15', identifier: 'SYN-MO-0442' },
  ],
  openTickets: [{ providerTicketId: 'SI-10388', title: 'VPN drops on hotel wifi', status: 'pending' }],
};

const schema: TicketSchemaDescriptor = {
  categories: [
    { value: 'network', label: 'Network' },
    { value: 'software', label: 'Software' },
  ],
  priorities: [
    { value: 'low', label: 'Low' },
    { value: 'urgent', label: 'Urgent' },
  ],
  requiredFields: ['title', 'description', 'category'],
  supportsAttachments: false,
  supportsComments: true,
};

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(profile, schema);

  it('greets using the first name, not the full display name', () => {
    expect(prompt).toContain('Priya');
  });

  it('includes the caller context the agent must not ask for', () => {
    expect(prompt).toContain('priya.raman@synergyit.example');
    expect(prompt).toContain('Finance');
    expect(prompt).toContain('Toronto HQ, 4th floor');
  });

  it('states the never-ask directive explicitly', () => {
    expect(prompt).toMatch(/NEVER ask/i);
  });

  it('lists the known assets with their identifiers, to prevent invented asset tags', () => {
    expect(prompt).toContain('SYN-LT-2291');
    expect(prompt).toContain('iPhone 15');
  });

  it('surfaces the caller open tickets so it can offer a comment instead of a duplicate', () => {
    expect(prompt).toContain('SI-10388');
  });

  it('injects the live category list from the provider rather than hardcoding one', () => {
    expect(prompt).toContain('network');
    expect(prompt).toContain('software');
  });

  it('forbids creating a ticket before the read-back is confirmed', () => {
    expect(prompt).toMatch(/propose_ticket/);
    expect(prompt).toMatch(/create_ticket/);
  });

  it('never contains a literal undefined or null from a missing profile field', () => {
    const sparse = buildSystemPrompt(
      { ...profile, department: null, jobTitle: null, location: null, phone: null, knownAssets: [], openTickets: [] },
      schema,
    );
    expect(sparse).not.toMatch(/undefined|\bnull\b/);
  });

  it('tells the agent to keep turns short, because this is speech', () => {
    expect(prompt).toMatch(/two sentences|2 sentences/i);
  });
});
