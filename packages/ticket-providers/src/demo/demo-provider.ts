import { randomUUID } from 'node:crypto';
import {
  TicketCategory,
  TicketPriority,
  type CreateTicketInput,
  type Page,
  type ProviderCallContext,
  type SqlClient,
  type Ticket,
  type TicketComment,
  type TicketProvider,
  type TicketQuery,
  type TicketSchemaDescriptor,
} from '@tca/contracts';

export { migrate } from './schema.js';

interface TicketRow {
  seq: string | number | bigint;
  id: string;
  ticket_number: string;
  reporter_subject: string;
  status: string;
  title: string;
  category: string;
  priority: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CommentRow {
  id: string;
  ticket_id: string;
  author_subject: string;
  body: string;
  created_at: Date | string;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const CATEGORY_LABELS: Record<string, string> = {
  hardware: 'Hardware',
  software: 'Software',
  network: 'Network',
  account_access: 'Account access',
  email: 'Email',
  printing: 'Printing',
  security: 'Security',
  telephony: 'Telephony',
  other: 'Other',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low — annoyance with a workaround',
  normal: 'Normal — blocks this caller only',
  high: 'High — blocks several people',
  urgent: 'Urgent — outage or security incident',
};

/**
 * Stand-in for Synergy Interact, backed by Postgres.
 *
 * Exists so the agent and app can be built and tested end to end before we have
 * Interact's API spec. It satisfies the same TicketProvider contract, so
 * replacing it is a config change rather than a rewrite.
 */
export class DemoTicketProvider implements TicketProvider {
  readonly name = 'demo';

  constructor(private readonly sql: SqlClient) {}

  async createTicket(input: CreateTicketInput, _ctx: ProviderCallContext): Promise<Ticket> {
    const payload = {
      description: input.description,
      reporter: input.reporter,
      affectedAsset: input.affectedAsset,
      impact: input.impact,
      troubleshootingTried: input.troubleshootingTried,
      source: input.source,
      transcriptRef: input.transcriptRef,
      tags: input.tags,
      providerExtras: input.providerExtras,
      url: null,
    };

    // ON CONFLICT DO NOTHING rather than an upsert: a repeated key means the
    // same call is being replayed, and the first write is the truth. Silently
    // overwriting would let a retry rewrite a ticket a technician already read.
    const inserted = await this.sql.query<TicketRow>(
      `INSERT INTO tickets
         (id, ticket_number, idempotency_key, reporter_subject, status, title, category, priority, payload)
       VALUES
         ($1, 'SI-' || lpad(nextval('ticket_number_seq')::text, 5, '0'), $2, $3, 'new', $4, $5, $6, $7::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        input.idempotencyKey,
        input.reporter.subject,
        input.title,
        input.category,
        input.priority,
        JSON.stringify(payload),
      ],
    );

    const row = inserted.rows[0];
    if (row) return this.hydrate(row, []);

    const existing = await this.findByIdempotencyKey(input.idempotencyKey, _ctx);
    if (existing) return existing;

    // Only reachable if the row vanished between the insert and the re-select.
    throw new Error(
      `createTicket could not resolve a ticket for idempotency key ${input.idempotencyKey}`,
    );
  }

  /**
   * Resolves either reference, and must.
   *
   * The agent never sees an internal id: OpenTicketRef carries
   * providerTicketId and nothing else, deliberately, and the reference read
   * back to the caller is the one they repeat on the next call. Matching only
   * `id` made every append 404 — the agent would agree to add a detail and the
   * detail went nowhere. Both columns are text and ticket_number is unique, so
   * there is nothing to disambiguate.
   */
  async getTicket(ref: string, _ctx: ProviderCallContext): Promise<Ticket | null> {
    const { rows } = await this.sql.query<TicketRow>(
      `SELECT * FROM tickets WHERE id = $1 OR ticket_number = $1`,
      [ref],
    );
    const row = rows[0];
    if (!row) return null;

    return this.hydrate(row, await this.commentsFor([row.id]));
  }

  async findByIdempotencyKey(key: string, _ctx: ProviderCallContext): Promise<Ticket | null> {
    const { rows } = await this.sql.query<TicketRow>(
      `SELECT * FROM tickets WHERE idempotency_key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return null;

    return this.hydrate(row, await this.commentsFor([row.id]));
  }

  async listTickets(query: TicketQuery, _ctx: ProviderCallContext): Promise<Page<Ticket>> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.reporterSubject) {
      params.push(query.reporterSubject);
      where.push(`reporter_subject = $${params.length}`);
    }
    if (query.status && query.status.length > 0) {
      params.push(query.status);
      where.push(`status = ANY($${params.length})`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`(title ILIKE $${params.length} OR payload->>'description' ILIKE $${params.length})`);
    }
    if (query.cursor) {
      params.push(query.cursor);
      where.push(`seq < $${params.length}`);
    }

    // Fetch one extra to tell "there is a next page" from "this page is exactly full".
    params.push(limit + 1);
    const { rows } = await this.sql.query<TicketRow>(
      `SELECT * FROM tickets
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY seq DESC
       LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const comments = await this.commentsFor(page.map((r) => r.id));
    const last = page.at(-1);

    return {
      items: page.map((row) => this.hydrate(row, comments)),
      nextCursor: hasMore && last ? String(last.seq) : null,
    };
  }

  /** Takes either reference too, for the reason getTicket does. */
  async addComment(ref: string, body: string, ctx: ProviderCallContext): Promise<void> {
    const { rows } = await this.sql.query<{ id: string }>(
      `SELECT id FROM tickets WHERE id = $1 OR ticket_number = $1`,
      [ref],
    );
    const id = rows[0]?.id;

    // Loud, because the alternative is a comment that silently lands nowhere
    // while the caller is told it was added.
    if (!id) throw new Error(`addComment: no ticket matches ${ref}`);

    await this.sql.query(
      `INSERT INTO ticket_comments (id, ticket_id, author_subject, body) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), id, ctx.actor.subject, body],
    );
    await this.sql.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [id]);
  }

  async describeSchema(_ctx: ProviderCallContext): Promise<TicketSchemaDescriptor> {
    return {
      categories: TicketCategory.options.map((value) => ({
        value,
        label: CATEGORY_LABELS[value] ?? value,
      })),
      priorities: TicketPriority.options.map((value) => ({
        value,
        label: PRIORITY_LABELS[value] ?? value,
      })),
      requiredFields: ['title', 'description', 'category', 'priority', 'impact'],
      supportsAttachments: false,
      supportsComments: true,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.sql.query(`SELECT 1`);
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private async commentsFor(ticketIds: string[]): Promise<CommentRow[]> {
    if (ticketIds.length === 0) return [];

    const { rows } = await this.sql.query<CommentRow>(
      `SELECT * FROM ticket_comments WHERE ticket_id = ANY($1) ORDER BY created_at ASC`,
      [ticketIds],
    );
    return rows;
  }

  private hydrate(row: TicketRow, commentRows: CommentRow[]): Ticket {
    const p = row.payload as {
      description: string;
      reporter: Ticket['reporter'];
      affectedAsset: Ticket['affectedAsset'];
      impact: Ticket['impact'];
      troubleshootingTried: string[];
      source: Ticket['source'];
      transcriptRef: Ticket['transcriptRef'];
      tags: string[];
      providerExtras: Record<string, unknown>;
      url: string | null;
    };

    const comments: TicketComment[] = commentRows
      .filter((c) => c.ticket_id === row.id)
      .map((c) => ({
        id: c.id,
        authorSubject: c.author_subject,
        body: c.body,
        createdAt: iso(c.created_at),
      }));

    return {
      id: row.id,
      providerTicketId: row.ticket_number,
      providerName: this.name,
      status: row.status as Ticket['status'],
      url: p.url,
      title: row.title,
      description: p.description,
      category: row.category as Ticket['category'],
      priority: row.priority as Ticket['priority'],
      reporter: p.reporter,
      affectedAsset: p.affectedAsset,
      impact: p.impact,
      troubleshootingTried: p.troubleshootingTried ?? [],
      source: p.source,
      transcriptRef: p.transcriptRef ?? null,
      tags: p.tags ?? [],
      providerExtras: p.providerExtras ?? {},
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      comments,
    };
  }
}
