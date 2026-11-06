import type { CallerProfile, SqlClient } from '@tca/contracts';

type SeedProfile = Omit<CallerProfile, 'openTickets'>;

/**
 * The demo directory.
 *
 * These two profiles are the fixtures the eval corpus is written against —
 * Priya has a laptop and a phone on record plus an open ticket, which is what
 * makes the asset-grounding (group F) and dedupe (group G) cases meaningful.
 * Dave exists so "I'm reporting this for my colleague Dave" (EV-ID-04) names a
 * real person the agent must still not file the ticket under.
 */
export const DEMO_USERS: readonly SeedProfile[] = [
  {
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
  },
  {
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
    knownAssets: [
      { kind: 'laptop', label: 'MacBook Pro 14', identifier: 'SYN-LT-3310' },
    ],
  },
];

export async function seedDemoUsers(sql: SqlClient): Promise<void> {
  for (const user of DEMO_USERS) {
    await sql.query(
      `INSERT INTO users (subject, email, tenant_id, profile)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (subject) DO UPDATE SET profile = EXCLUDED.profile`,
      [user.subject, user.email, user.tenantId, JSON.stringify(user)],
    );
  }
}
