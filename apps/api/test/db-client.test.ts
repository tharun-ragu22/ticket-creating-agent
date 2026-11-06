import { describe, it, expect } from 'vitest';
import { createSqlClient } from '../src/db/client.js';

describe('createSqlClient', () => {
  it('runs real SQL against an in-memory PGlite url', async () => {
    const db = await createSqlClient('pglite://:memory:');
    try {
      const { rows } = await db.sql.query<{ n: number }>('SELECT 1 + 1 AS n');
      expect(rows[0]?.n).toBe(2);
    } finally {
      await db.close();
    }
  });

  /**
   * The constraint the whole duplicate-ticket defence rests on. Asserting it
   * here as well as in the provider suite pins that the chosen client surfaces
   * a constraint violation as an error rather than swallowing it.
   */
  it('enforces UNIQUE constraints, which is why PGlite is used rather than a fake', async () => {
    const db = await createSqlClient('pglite://:memory:');
    try {
      await db.sql.query('CREATE TABLE t (k text UNIQUE)');
      await db.sql.query('INSERT INTO t (k) VALUES ($1)', ['a']);
      await expect(db.sql.query('INSERT INTO t (k) VALUES ($1)', ['a'])).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it('rejects an unrecognised url scheme rather than guessing', async () => {
    await expect(createSqlClient('mysql://localhost/tca')).rejects.toThrow(/mysql|scheme|unsupported/i);
  });

  it('names both supported schemes in the error, so the fix is in the message', async () => {
    await expect(createSqlClient('nonsense')).rejects.toThrow(/pglite:\/\/.*postgres:\/\/|postgres:\/\/.*pglite:\/\//s);
  });
});
