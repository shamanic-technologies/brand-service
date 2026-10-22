import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';
import { restoreDriverErrorMessages } from '../../src/lib/pg-error';

/** The shape postgres.js raises for a unique-index violation. */
function pgUniqueViolation(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint_name: constraint,
  });
}

// queryWithCache is where every pg dialect query error is wrapped; call it the way the
// postgres-js session does (no cache configured).
const run = (query: () => Promise<unknown>) =>
  (PgPreparedQuery.prototype as unknown as {
    queryWithCache: (q: string, p: unknown[], f: () => Promise<unknown>) => Promise<unknown>;
  }).queryWithCache.call({ cache: undefined, queryMetadata: undefined }, 'insert into brands (domain) values ($1)', ['secret@x.com'], query);

describe('restoreDriverErrorMessages (drizzle-orm >= 0.44 puts SQL + params in the message)', () => {
  it('without it, drizzle leaks the SQL text and the bound values in the message', async () => {
    const err = new DrizzleQueryError('insert into brands (domain) values ($1)', ['secret@x.com'], pgUniqueViolation('idx_a'));
    expect(err.message).toContain('Failed query');
    expect(err.message).toContain('secret@x.com');
  });

  it("keeps the wrapper (cause, query, params) but the message is the database's again, SQL and values gone", async () => {
    restoreDriverErrorMessages();
    restoreDriverErrorMessages(); // idempotent
    const pg = pgUniqueViolation('idx_a');
    const err = await run(() => Promise.reject(pg)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DrizzleQueryError);
    expect((err as Error).message).toBe('duplicate key value violates unique constraint "idx_a"');
    expect((err as Error).message).not.toContain('secret@x.com');
    expect(String((err as Error).stack)).not.toContain('Failed query');
    expect(String((err as Error).stack)).not.toContain('secret@x.com');
    expect((err as DrizzleQueryError).cause).toBe(pg);
    expect(((err as DrizzleQueryError).cause as { code?: string }).code).toBe('23505');
  });

  it('passes results through untouched', async () => {
    restoreDriverErrorMessages();
    expect(await run(() => Promise.resolve([{ ok: 1 }]))).toEqual([{ ok: 1 }]);
  });

  it('the db client installs it', async () => {
    process.env.BRAND_SERVICE_DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/never-connected';
    await import('../../src/db/index');
    expect((PgPreparedQuery.prototype as unknown as Record<symbol, unknown>)[Symbol.for('distribute.drizzle-query-error-message')]).toBe(true);
  });
});
