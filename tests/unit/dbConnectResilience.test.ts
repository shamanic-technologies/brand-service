import { describe, it, expect, beforeAll } from 'vitest';
import net from 'net';

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
});
