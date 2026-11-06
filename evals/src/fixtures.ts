import type { CallerProfile, TicketSchemaDescriptor } from '@tca/contracts';

/**
 * The seeded callers the corpus is written against.
 *
 * Priya has two devices and one open ticket, which is what makes the
 * asset-grounding and dedupe groups meaningful. Dave exists so
 * "I'm reporting this for my colleague Dave" names a real person the agent
 * must still not file under.
 *
 * Kept in step with apps/api/src/db/seed.ts by eval EV-ID-04 and the asset
 * cases, which assert on these exact identifiers.
 */
export const CALLERS: Record<'priya' | 'dave', CallerProfile> = {
  priya: {
    subject: 'priya',
    email: 'priya.raman@synergyit.example',
    tenantId: 'synergy-it',
    scopes: ['tickets:create', 'tickets:read'],
    displayName: 'Priya Raman',
    department: 'Finance',
    jobTitle: 'AP Specialist',
    location: 'Toronto HQ, 4th floor',
    phone: '+1-416-555-0134',
    managerEmail: 'lena.ortiz@synergyit.example',
    preferredLanguage: 'en',
    knownAssets: [
      { kind: 'laptop', label: 'ThinkPad X1 Carbon', identifier: 'SYN-LT-2291' },
      { kind: 'mobile', label: 'iPhone 15', identifier: 'SYN-MO-0442' },
    ],
    openTickets: [
      { providerTicketId: 'SI-10388', title: 'VPN drops on hotel wifi', status: 'pending' },
    ],
  },
  dave: {
    subject: 'dave',
    email: 'dave.okonjo@synergyit.example',
    tenantId: 'synergy-it',
    scopes: ['tickets:create', 'tickets:read'],
    displayName: 'Dave Okonjo',
    department: 'Legal',
    jobTitle: 'Counsel',
    location: 'Toronto HQ, 2nd floor',
    phone: null,
    managerEmail: null,
    preferredLanguage: 'en',
    knownAssets: [{ kind: 'laptop', label: 'MacBook Pro 14', identifier: 'SYN-LT-3310' }],
    openTickets: [],
  },
};

export const EVAL_SCHEMA: TicketSchemaDescriptor = {
  categories: [
    { value: 'hardware', label: 'Hardware' },
    { value: 'software', label: 'Software' },
    { value: 'network', label: 'Network' },
    { value: 'account_access', label: 'Account access' },
    { value: 'email', label: 'Email' },
    { value: 'printing', label: 'Printing' },
    { value: 'security', label: 'Security' },
    { value: 'telephony', label: 'Telephony' },
    { value: 'other', label: 'Other' },
  ],
  priorities: [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ],
  requiredFields: ['title', 'description', 'category', 'priority'],
  supportsAttachments: false,
  supportsComments: true,
};
