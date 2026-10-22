import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db';

// A real duplicate key through the real driver + drizzle: the error our routes answer with or
// store must carry the database's reason, never the SQL text or the bound values.
const TABLE = 'pg_error_message_probe_sec2';

describe('failed query message against a real Postgres', () => {
  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
  });

  it("is the database's own message: no SQL, no params", async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
    await db.execute(sql.raw(`CREATE TABLE ${TABLE} (k text, CONSTRAINT ${TABLE}_k_uniq UNIQUE (k))`));
    await db.execute(sql`INSERT INTO ${sql.raw(TABLE)} (k) VALUES (${'secret-value'})`);
    let caught: unknown;
    try {
      await db.execute(sql`INSERT INTO ${sql.raw(TABLE)} (k) VALUES (${'secret-value'})`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toBe(`duplicate key value violates unique constraint "${TABLE}_k_uniq"`);
    expect(message).not.toContain('INSERT');
    expect(message).not.toContain('secret-value');
    expect(((caught as { cause?: { code?: string } }).cause)?.code).toBe('23505');
  });
});
