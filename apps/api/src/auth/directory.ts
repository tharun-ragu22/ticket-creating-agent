import {
  CallerProfile,
  type CallerDirectory,
  type CallerIdentity,
  type OpenTicketRef,
  type ProviderCallContext,
  type SqlClient,
  type TicketProvider,
} from '@tca/contracts';

export class CallerNotFoundError extends Error {
  constructor(subject: string) {
    super(`No caller profile for subject "${subject}"`);
    this.name = 'CallerNotFoundError';
  }
}

/** Statuses that count as "still being worked", for the dedupe hints. */
const OPEN_STATUSES = ['new', 'open', 'pending'] as const;

/**
 * Resolves a verified subject into everything the agent needs so it never has
 * to ask the caller a question it could have answered itself.
 *
 * `openTickets` is read live from the ticket provider rather than stored,
 * because it is the raw material for the dedupe behaviour: the agent can only
 * offer "is this the same as SI-10388?" if it knows SI-10388 is open.
 */
export class SqlCallerDirectory implements CallerDirectory {
  readonly name = 'demo-seed';

  constructor(
    private readonly sql: SqlClient,
    private readonly tickets: TicketProvider,
  ) {}

  lookup(identity: CallerIdentity): Promise<CallerProfile> {
    return this.lookupBySubject(identity.subject);
  }

  /**
   * Subject-only lookup, used by the agent: all it has is the `caller.subject`
   * participant attribute, never a bearer token belonging to the caller.
   */
  async lookupBySubject(subject: string): Promise<CallerProfile> {
    const { rows } = await this.sql.query<{ profile: unknown }>(
      `SELECT profile FROM users WHERE subject = $1`,
      [subject],
    );

    const row = rows[0];
    if (!row) throw new CallerNotFoundError(subject);

    const stored = typeof row.profile === 'string' ? JSON.parse(row.profile) : row.profile;

    return CallerProfile.parse({
      ...(stored as Record<string, unknown>),
      openTickets: await this.openTicketsFor(subject),
    });
  }

  async list(): Promise<CallerProfile[]> {
    const { rows } = await this.sql.query<{ subject: string }>(
      `SELECT subject FROM users ORDER BY subject`,
    );
    return Promise.all(rows.map((r) => this.lookupBySubject(r.subject)));
  }

  private async openTicketsFor(subject: string): Promise<OpenTicketRef[]> {
    const ctx: ProviderCallContext = {
      actor: { subject, email: '', displayName: '' },
      requestId: `directory_${subject}`,
    };

    const page = await this.tickets.listTickets(
      { reporterSubject: subject, status: [...OPEN_STATUSES], limit: 10 },
      ctx,
    );

    return page.items.map((t) => ({
      providerTicketId: t.providerTicketId,
      title: t.title,
      status: t.status,
    }));
  }
}

/**
 * The directory surface the API actually needs.
 *
 * `CallerDirectory` in contracts is the narrow port the agent programs
 * against; these two extras exist because the API has jobs the agent does
 * not — resolving a subject with no caller token in hand, and rendering the
 * demo user picker.
 */
export interface ApiCallerDirectory extends CallerDirectory {
  lookupBySubject(subject: string): Promise<CallerProfile>;
  list(): Promise<CallerProfile[]>;
}
