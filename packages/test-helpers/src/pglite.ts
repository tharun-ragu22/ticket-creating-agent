import { PGlite } from '@electric-sql/pglite';
import type { SqlClient } from '@tca/contracts';

export type { SqlClient };

export interface TestDatabase {
  sql: SqlClient;
  teardown: () => Promise<void>;
}

/**
 * An in-process Postgres for tests.
 *
 * PGlite is real Postgres compiled to WASM, not a mock, so UNIQUE constraints
 * and ON CONFLICT behave exactly as they will in production. That matters here:
 * the duplicate-ticket defence rests on those semantics, and an in-memory fake
 * would let a broken implementation pass.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();

  return {
    sql: {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await db.query<T>(sql, params as never[] | undefined);
        return { rows: result.rows };
      },
    },
    teardown: () => db.close(),
  };
}
