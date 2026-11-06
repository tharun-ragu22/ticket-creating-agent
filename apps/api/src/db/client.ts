import type { SqlClient } from '@tca/contracts';

export interface Database {
  sql: SqlClient;
  close: () => Promise<void>;
}

/**
 * Opens the demo ticket store.
 *
 * Two schemes, both real Postgres:
 *
 *   pglite://./data/tca     file-backed, persists across restarts
 *   pglite://:memory:       throwaway
 *   postgres://user@host/db a Postgres server
 *
 * PGlite is the default for the demo because it needs no Docker and no running
 * server, while still being Postgres — the UNIQUE and ON CONFLICT semantics
 * the duplicate-ticket defence depends on behave identically. The postgres://
 * branch exists so the same code runs against a real server when Synergy IT
 * deploys this; it is the path to use for anything beyond one developer's
 * machine, since PGlite is single-process.
 */
export async function createSqlClient(databaseUrl: string): Promise<Database> {
  if (databaseUrl.startsWith('pglite://')) {
    return openPglite(databaseUrl.slice('pglite://'.length));
  }
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return openPostgres(databaseUrl);
  }

  throw new Error(
    `Unsupported DATABASE_URL "${redact(databaseUrl)}". ` +
      'Use pglite://<path> (or pglite://:memory:) for the demo store, ' +
      'or postgres://… for a Postgres server.',
  );
}

async function openPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(dataDir === ':memory:' ? undefined : { dataDir });

  return {
    sql: {
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const result = await db.query<T>(text, params as never[] | undefined);
        return { rows: result.rows };
      },
    },
    close: () => db.close(),
  };
}

async function openPostgres(connectionString: string): Promise<Database> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 10 });

  // Fail at startup rather than on the first ticket of the first call.
  await pool.query('SELECT 1');

  return {
    sql: {
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const result = await pool.query(text, params as unknown[]);
        return { rows: result.rows as T[] };
      },
    },
    close: () => pool.end(),
  };
}

/** Connection strings carry passwords; this only ever reaches an error message. */
const redact = (url: string): string => url.replace(/\/\/[^@/]*@/, '//***@');
