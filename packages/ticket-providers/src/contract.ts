import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeCreateTicketInput, PRIYA, DAVE } from '@tca/test-helpers';
import { Ticket, type ProviderCallContext, type TicketProvider } from '@tca/contracts';

export interface ProviderHarness {
  provider: TicketProvider;
  teardown: () => Promise<void>;
}

const ctx: ProviderCallContext = {
  actor: { subject: 'priya', email: 'priya.raman@synergyit.example', displayName: 'Priya Raman' },
  requestId: 'req_contract',
};

/**
 * The behaviour every TicketProvider must exhibit, regardless of what sits
 * behind it.
 *
 * Run against DemoTicketProvider, TicketApiClient and — once its spec arrives —
 * SynergyInteractProvider. That last one is the reason this suite is shared:
 * swapping the ticketing system is only safe if the replacement is proven to
 * behave identically, not merely asserted to.
 */
export function describeTicketProviderContract(
  name: string,
  makeProvider: () => Promise<ProviderHarness>,
): void {
  describe(`TicketProvider contract: ${name}`, () => {
    let harness: ProviderHarness;
    let provider: TicketProvider;

    beforeAll(async () => {
      harness = await makeProvider();
      provider = harness.provider;
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it('exposes a stable name', () => {
      expect(provider.name).toBeTruthy();
      expect(typeof provider.name).toBe('string');
    });

    it('creates a ticket and returns a provider-assigned reference', async () => {
      const input = makeCreateTicketInput();
      const ticket = await provider.createTicket(input, ctx);

      expect(ticket.providerTicketId).toBeTruthy();
      expect(ticket.id).toBeTruthy();
      expect(ticket.status).toBe('new');
      expect(ticket.title).toBe(input.title);
    });

    it('returns a ticket that satisfies the Ticket schema', async () => {
      const ticket = await provider.createTicket(makeCreateTicketInput(), ctx);
      expect(() => Ticket.parse(ticket)).not.toThrow();
    });

    it('preserves the reporter exactly as given, since the agent cannot be trusted with it', async () => {
      const ticket = await provider.createTicket(makeCreateTicketInput({ reporter: DAVE }), ctx);
      expect(ticket.reporter).toEqual(DAVE);
    });

    it('preserves impact, affected asset and troubleshooting notes', async () => {
      const input = makeCreateTicketInput();
      const ticket = await provider.createTicket(input, ctx);

      expect(ticket.impact).toEqual(input.impact);
      expect(ticket.affectedAsset).toEqual(input.affectedAsset);
      expect(ticket.troubleshootingTried).toEqual(input.troubleshootingTried);
    });

    it('accepts a ticket with no affected asset', async () => {
      const ticket = await provider.createTicket(
        makeCreateTicketInput({ affectedAsset: null }),
        ctx,
      );
      expect(ticket.affectedAsset).toBeNull();
    });

    // ── Idempotency. This is the highest-severity behaviour in the system:
    // a help desk that files two tickets per call loses trust immediately.
    it('returns the SAME ticket for a repeated idempotency key', async () => {
      const input = makeCreateTicketInput();
      const first = await provider.createTicket(input, ctx);
      const second = await provider.createTicket(input, ctx);

      expect(second.id).toBe(first.id);
      expect(second.providerTicketId).toBe(first.providerTicketId);
    });

    it('does not create a second ticket for a repeated idempotency key', async () => {
      const input = makeCreateTicketInput({ reporter: { ...PRIYA, subject: 'dedupe-probe' } });
      await provider.createTicket(input, ctx);
      await provider.createTicket(input, ctx);

      const page = await provider.listTickets({ reporterSubject: 'dedupe-probe' }, ctx);
      expect(page.items).toHaveLength(1);
    });

    it('ignores a changed payload when the idempotency key repeats', async () => {
      const input = makeCreateTicketInput();
      const first = await provider.createTicket(input, ctx);
      const second = await provider.createTicket(
        { ...input, title: 'A completely different title for the same key' },
        ctx,
      );

      expect(second.id).toBe(first.id);
      expect(second.title).toBe(first.title);
    });

    it('findByIdempotencyKey returns the ticket for a known key', async () => {
      const input = makeCreateTicketInput();
      const created = await provider.createTicket(input, ctx);
      const found = await provider.findByIdempotencyKey(input.idempotencyKey, ctx);

      expect(found?.id).toBe(created.id);
    });

    it('findByIdempotencyKey returns null for an unknown key', async () => {
      expect(await provider.findByIdempotencyKey('never-used-key-0000000', ctx)).toBeNull();
    });

    it('getTicket round-trips a created ticket', async () => {
      const created = await provider.createTicket(makeCreateTicketInput(), ctx);
      const fetched = await provider.getTicket(created.id, ctx);

      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe(created.title);
    });

    it('getTicket returns null for an unknown id', async () => {
      expect(await provider.getTicket('no-such-ticket', ctx)).toBeNull();
    });

    it('listTickets filters by reporter subject', async () => {
      const mine = { ...PRIYA, subject: 'filter-mine' };
      const theirs = { ...DAVE, subject: 'filter-theirs' };
      await provider.createTicket(makeCreateTicketInput({ reporter: mine }), ctx);
      await provider.createTicket(makeCreateTicketInput({ reporter: mine }), ctx);
      await provider.createTicket(makeCreateTicketInput({ reporter: theirs }), ctx);

      const page = await provider.listTickets({ reporterSubject: 'filter-mine' }, ctx);
      expect(page.items).toHaveLength(2);
      expect(page.items.every((t) => t.reporter.subject === 'filter-mine')).toBe(true);
    });

    it('listTickets paginates with a cursor and stops cleanly', async () => {
      const reporter = { ...PRIYA, subject: 'pager' };
      for (let i = 0; i < 3; i += 1) {
        await provider.createTicket(makeCreateTicketInput({ reporter }), ctx);
      }

      const first = await provider.listTickets({ reporterSubject: 'pager', limit: 2 }, ctx);
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();

      const second = await provider.listTickets(
        { reporterSubject: 'pager', limit: 2, cursor: first.nextCursor! },
        ctx,
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();

      const ids = [...first.items, ...second.items].map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('listTickets filters by status', async () => {
      const reporter = { ...PRIYA, subject: 'status-filter' };
      await provider.createTicket(makeCreateTicketInput({ reporter }), ctx);

      const open = await provider.listTickets(
        { reporterSubject: 'status-filter', status: ['new'] },
        ctx,
      );
      expect(open.items).toHaveLength(1);

      const closed = await provider.listTickets(
        { reporterSubject: 'status-filter', status: ['closed'] },
        ctx,
      );
      expect(closed.items).toHaveLength(0);
    });

    it('addComment is reflected on the ticket, so a duplicate report can append instead of filing again', async () => {
      const created = await provider.createTicket(makeCreateTicketInput(), ctx);
      await provider.addComment(created.id, 'Caller reported this again on a second call.', ctx);

      const fetched = await provider.getTicket(created.id, ctx);
      expect(fetched?.comments.map((c) => c.body)).toContain(
        'Caller reported this again on a second call.',
      );
    });

    it('describeSchema advertises non-empty categories and priorities', async () => {
      const schema = await provider.describeSchema(ctx);

      expect(schema.categories.length).toBeGreaterThan(0);
      expect(schema.priorities.length).toBeGreaterThan(0);
      expect(schema.categories.every((c) => c.value && c.label)).toBe(true);
      expect(schema.requiredFields).toContain('title');
    });

    it('healthCheck reports ok', async () => {
      await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
    });
  });
}
