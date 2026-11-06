import { z } from 'zod';
import { AssetKind, TicketStatus } from './ticket.js';

export const KnownAsset = z.object({
  kind: AssetKind,
  label: z.string().min(1),
  identifier: z.string().nullable(),
});
export type KnownAsset = z.infer<typeof KnownAsset>;

export const OpenTicketRef = z.object({
  providerTicketId: z.string(),
  title: z.string(),
  status: TicketStatus,
});
export type OpenTicketRef = z.infer<typeof OpenTicketRef>;

/** What verifying the app's bearer token establishes. */
export const CallerIdentity = z.object({
  subject: z.string().min(1),
  email: z.email(),
  tenantId: z.string().min(1),
  scopes: z.array(z.string()),
});
export type CallerIdentity = z.infer<typeof CallerIdentity>;

/** Identity plus everything the agent needs so it never has to ask. */
export const CallerProfile = CallerIdentity.extend({
  displayName: z.string().min(1),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  location: z.string().nullable(),
  phone: z.string().nullable(),
  managerEmail: z.string().nullable(),
  preferredLanguage: z.string(),
  knownAssets: z.array(KnownAsset),
  openTickets: z.array(OpenTicketRef),
});
export type CallerProfile = z.infer<typeof CallerProfile>;

export interface IdentityProvider {
  readonly name: string;
  verify(bearerToken: string): Promise<CallerIdentity>;
}

export interface CallerDirectory {
  readonly name: string;
  lookup(identity: CallerIdentity): Promise<CallerProfile>;
}
