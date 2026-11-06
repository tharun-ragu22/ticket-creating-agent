import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, makeCreateTicketInput, type SqlClient } from '@tca/test-helpers';
import type { ProviderCallContext } from '@tca/contracts';
import { describeTicketProviderContract } from '../contract.js';
import { DemoTicketProvider, migrate } from './demo-provider.js';

describeTicketProviderContract('DemoTicketProvider (PGlite)', async () => {
  const db = await createTestDatabase();
  await migrate(db.sql);
  return { provider: new DemoTicketProvider(db.sql), teardown: db.teardown };
});

const ctx: ProviderCallContext = {
  actor: { subject: 'priya', email: 'priya.raman@synergyit.example', displayName: 'Priya Raman' },
  requestId: 'req_demo',
};

describe('DemoTicketProvider specifics', () => {
  let sql: SqlClient;
  let teardown: () => Promise<void>;
  let provider: DemoTicketProvider;

  beforeEach(async () => {
    const db = await createTestDatabase();
    await migrate(db.sql);
    sql = db.sql;
    teardown = db.teardown;
    provider = new DemoTicketProvider(db.sql);
  });

  afterEach(async () => {
    await teardown();
  });

  it('issues human-readable, sequential ticket numbers a caller can repeat back', async () => {
    const a = await provider.createTicket(makeCreateTicketInput(), ctx);
    const b = await provider.createTicket(makeCreateTicketInput(), ctx);

    expect(a.providerTicketId).toMatch(/^SI-\d{5}$/);
    expect(b.providerTicketId).toMatch(/^SI-\d{5}$/);
    expect(a.providerTicketId).not.toBe(b.providerTicketId);
  });

  // The database constraint is the only duplicate-ticket defence that cannot be
  // bypassed by a retry, a worker restart or a model calling the tool twice.
  it('enforces idempotency at the database level, not just in application code', async () => {
    const input = makeCreateTicketInput();
    await provider.createTicket(input, ctx);

    await expect(
      sql.query('INSERT INTO tickets (id, ticket_number, idempotency_key, reporter_subject, status, title, category, priority, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        'forced-duplicate',
        'SI-99999',
        input.idempotencyKey,
        'priya',
        'new',
        'a forced duplicate insert',
        'software',
        'low',
        '{}',
      ]),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('collapses concurrent creates with the same key into one ticket', async () => {
    const input = makeCreateTicketInput();

    const results = await Promise.all([
      provider.createTicket(input, ctx),
      provider.createTicket(input, ctx),
      provider.createTicket(input, ctx),
    ]);

    const ids = new Set(results.map((t) => t.id));
    expect(ids.size).toBe(1);

    const { rows } = await sql.query<{ count: string }>('SELECT count(*)::text AS count FROM tickets');
    expect(rows[0]?.count).toBe('1');
  });

  it('migrate is safe to run twice', async () => {
    await expect(migrate(sql)).resolves.not.toThrow();
  });

  it('stores timestamps as ISO strings the Ticket schema accepts', async () => {
    const ticket = await provider.createTicket(makeCreateTicketInput(), ctx);
    expect(ticket.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(ticket.createdAt).toString()).not.toBe('Invalid Date');
  });
});
