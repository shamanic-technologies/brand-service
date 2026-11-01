import { describe, it, expect, beforeAll } from 'vitest';
import net from 'net';
import fs from 'fs';
import path from 'path';

/**
 * Regression for the `AggregateError [ETIMEDOUT]` that took down two integration files
 * once CI started provisioning a fresh Neon branch per run:
 *
 *   cause: AggregateError:
 *       at internalConnectMultiple (node:net:1122:18)
 *       at Timeout.internalConnectMultipleTimeout (node:net:1716:5)
 *     code: 'ETIMEDOUT'
 *     [errors]: [ [Error], [Error], [Error], [Error], [Error], [Error] ]
 *
 * Neon's pooler resolves to several addresses and Node 20 gives each candidate only 250ms,
 * which a resuming or far-away compute cannot always answer within. The db module raises
 * that per-candidate budget at import time; this asserts it actually took effect, because
 * the symptom only reproduces against a cold remote database.
 */
describe('db client connect resilience', () => {
  beforeAll(async () => {
    // Importing src/db throws without a DSN, and the unit job runs without one. The value
    // is never dialed: postgres.js connects lazily, on the first query.
    process.env.BRAND_SERVICE_DATABASE_URL ||= 'postgresql://u:p@localhost:5432/db';
    await import('../../src/db');
  });

  it('raises the happy-eyeballs per-candidate timeout above the 250ms default', () => {
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBeGreaterThanOrEqual(5000);
  });

  /**
   * PG-CONN-1101: the box Postgres has 300 slots shared by ~30 pools. postgres.js reuses its
   * open connections in turn, so a pool that once grew to `max` stays at `max` unless
   * connections are recycled. The pool is capped at 5 and recycled (idle 60s, lifetime 300s).
   * (The Neon-era rule "never set idle_timeout" kept a cross-region socket warm; the database
   * is now local to the box, so a reconnect costs nothing.)
   *
   * Asserted against the source rather than the client, which drizzle does not expose.
   */
  it('caps the pool at 5 and recycles connections (PG-CONN-1101)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/db/index.ts'), 'utf-8');
    expect(source).toMatch(/max: 5,/);
    expect(source).toMatch(/idle_timeout: 60,/);
    expect(source).toMatch(/max_lifetime: 300,/);
  });
});
