import type { SqlClient } from '@tca/contracts';

/**
 * Tables the API owns, as opposed to the ones the ticket provider owns.
 *
 * `users` is the demo caller directory. Under a real identity provider this
 * becomes a read-through cache of Entra or Okta, which is why the profile
 * fields live in a jsonb column rather than being normalised: we do not want
 * a migration every time Synergy IT adds an attribute.
 *
 * `transcripts` is API-owned on purpose. Synergy Interact may accept an
 * attachment or it may not; either way the recording of what was said belongs
 * to us and must survive a provider swap.
 */
export async function migrateApi(sql: SqlClient): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS users (
      subject     text        PRIMARY KEY,
      email       text        NOT NULL UNIQUE,
      tenant_id   text        NOT NULL,
      profile     jsonb       NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id             text        PRIMARY KEY,
      room_name      text        NOT NULL,
      session_id     text        NOT NULL,
      caller_subject text        NOT NULL,
      turns          jsonb       NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(
    `CREATE INDEX IF NOT EXISTS transcripts_room_idx ON transcripts (room_name, created_at DESC)`,
  );
}
