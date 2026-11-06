/**
 * The minimal database surface shared by node-postgres and PGlite.
 *
 * Declared as a port here so provider implementations stay driver-agnostic:
 * the same code runs against real Postgres in development and against
 * in-process PGlite in tests, which is what lets the idempotency tests
 * exercise genuine UNIQUE and ON CONFLICT semantics.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
