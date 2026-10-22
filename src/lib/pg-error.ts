import { DrizzleQueryError } from 'drizzle-orm';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';

/**
 * Since drizzle-orm 0.44 a failed query throws DrizzleQueryError whose MESSAGE is
 * `Failed query: <SQL>\nparams: <values>`. Every `err.message` we answer with (HTTP bodies) or
 * store (error columns, run/trace details) would leak the SQL text and the bound values, and hide
 * the database's reason. Every pg query error is raised from one place,
 * `PgPreparedQuery.queryWithCache`: wrap it once so the thrown DrizzleQueryError carries the
 * driver's own message (e.g. `duplicate key value violates unique constraint "..."`).
 * The error stays a DrizzleQueryError with `cause` (the postgres error), `query` and `params`
 * for code checks and server-side logs. Idempotent; installed by the db client.
 */
const PATCHED = Symbol.for('distribute.drizzle-query-error-message');

export function restoreDriverErrorMessages(): void {
  const proto = PgPreparedQuery.prototype as unknown as Record<string | symbol, unknown> & {
    queryWithCache: (...args: unknown[]) => Promise<unknown>;
  };
  if (proto[PATCHED]) return;
  const original = proto.queryWithCache;
  proto.queryWithCache = async function (this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (err) {
      if (err instanceof DrizzleQueryError && err.cause instanceof Error) {
        // Before anything reads `stack` (V8 formats it lazily from the current message).
        err.message = err.cause.message;
      }
      throw err;
    }
  };
  proto[PATCHED] = true;
}
