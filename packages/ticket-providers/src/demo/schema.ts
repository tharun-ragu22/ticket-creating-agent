import type { SqlClient } from '@tca/contracts';

/**
 * The demo ticket store.
 *
 * `idempotency_key` carries a UNIQUE constraint on purpose: it is the one layer
 * of the duplicate-ticket defence that a retry, a worker restart or a model
 * calling the tool twice cannot bypass. The other three layers live in the
 * agent and the API.
 *
 * `seq` exists so pagination is deterministic. Ordering on created_at ties when
 * several tickets land in the same millisecond, which happens constantly in
 * tests and occasionally in production.
 */
export async function migrate(sql: SqlClient): Promise<void> {
  await sql.query(`CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 10001`);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      seq              bigserial    NOT NULL,
      id               text         PRIMARY KEY,
      ticket_number    text         NOT NULL UNIQUE,
      idempotency_key  text         NOT NULL UNIQUE,
      reporter_subject text         NOT NULL,
      status           text         NOT NULL,
      title            text         NOT NULL,
      category         text         NOT NULL,
      priority         text         NOT NULL,
      payload          jsonb        NOT NULL,
      created_at       timestamptz  NOT NULL DEFAULT now(),
      updated_at       timestamptz  NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id             text        PRIMARY KEY,
      ticket_id      text        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_subject text        NOT NULL,
      body           text        NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(
    `CREATE INDEX IF NOT EXISTS tickets_reporter_seq_idx ON tickets (reporter_subject, seq DESC)`,
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx ON ticket_comments (ticket_id, created_at)`,
  );
}
