import { z } from 'zod';

export const TicketPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export type TicketPriority = z.infer<typeof TicketPriority>;

export const TicketCategory = z.enum([
  'hardware',
  'software',
  'network',
  'account_access',
  'email',
  'printing',
  'security',
  'telephony',
  'other',
]);
export type TicketCategory = z.infer<typeof TicketCategory>;

export const TicketStatus = z.enum(['new', 'open', 'pending', 'resolved', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const AssetKind = z.enum([
  'laptop',
  'desktop',
  'mobile',
  'printer',
  'application',
  'network',
  'peripheral',
  'other',
]);

/**
 * Identity of the person a ticket is filed for. Always derived from the
 * authenticated session, never from anything the agent heard on the call.
 */
export const ReporterRef = z.object({
  subject: z.string().min(1),
  displayName: z.string().min(1),
  email: z.email(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  location: z.string().nullable(),
  phone: z.string().nullable(),
});
export type ReporterRef = z.infer<typeof ReporterRef>;

export const AffectedAsset = z.object({
  kind: AssetKind,
  label: z.string().min(1),
  /** Asset tag or serial. Null when the kit is not on record — never invented. */
  identifier: z.string().nullable(),
});
export type AffectedAsset = z.infer<typeof AffectedAsset>;

export const ImpactAssessment = z.object({
  scope: z.enum(['self', 'team', 'site', 'company']),
  usersAffected: z.number().int().positive().nullable(),
  workBlocked: z.boolean(),
});
export type Impact = z.infer<typeof ImpactAssessment>;

export const CallSource = z.object({
  channel: z.literal('voice'),
  sessionId: z.string().min(1),
  roomName: z.string().min(1),
  startedAt: z.iso.datetime(),
});
export type CallSource = z.infer<typeof CallSource>;

export const TranscriptRef = z.object({ id: z.string().min(1), uri: z.string().min(1) });
export type TranscriptRef = z.infer<typeof TranscriptRef>;

/**
 * The schema the LLM is allowed to fill in.
 *
 * Deliberately narrower than CreateTicketInput: it has no `reporter`, `source`,
 * `idempotencyKey` or `transcriptRef`. The runtime supplies those, so the model
 * is structurally incapable of deciding who reported a ticket or of forging the
 * dedupe key. Do not widen this without reading the tests in ticket.test.ts.
 */
export const ProposeTicketToolInput = z.object({
  title: z.string().min(8).max(120),
  description: z.string().min(20).max(4000),
  category: TicketCategory,
  priority: TicketPriority,
  affectedAsset: AffectedAsset.nullable(),
  impact: ImpactAssessment,
  troubleshootingTried: z.array(z.string()).default([]),
});
export type TicketDraft = z.infer<typeof ProposeTicketToolInput>;

export const CreateTicketInput = ProposeTicketToolInput.extend({
  idempotencyKey: z.string().min(16),
  reporter: ReporterRef,
  source: CallSource,
  transcriptRef: TranscriptRef.nullable().default(null),
  tags: z.array(z.string()).default([]),
  providerExtras: z.record(z.string(), z.unknown()).default({}),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;

export const TicketComment = z.object({
  id: z.string(),
  authorSubject: z.string(),
  body: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type TicketComment = z.infer<typeof TicketComment>;

export const Ticket = CreateTicketInput.omit({ idempotencyKey: true }).extend({
  id: z.string(),
  providerTicketId: z.string(),
  providerName: z.string(),
  status: TicketStatus,
  url: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  comments: z.array(TicketComment).default([]),
});
export type Ticket = z.infer<typeof Ticket>;
