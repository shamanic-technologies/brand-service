import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import net from 'net';
import 'dotenv/config';
import * as schema from './schema';

const connectionString = process.env.BRAND_SERVICE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set');
}

// Neon resolves the pooler to several addresses, and Node 20's happy-eyeballs gives each
// candidate only 250ms. A compute that is resuming from scale-to-zero, or simply far away
// (production and CI both run in ap-southeast-1), routinely needs longer than that, so the
// whole connect fails with `AggregateError [ETIMEDOUT]` before any candidate answers. The
// query never dispatched, so nothing is half-applied — it surfaces as a 500 on the first
// request after an idle period, and as flaky mid-suite failures in CI.
//
// This is a connect-phase failure, not a slow query: the stack bottoms out in
// `internalConnectMultipleTimeout (node:net)`, never in query execution. Do not go looking
// for a missing index.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

// Create postgres client for Drizzle
const client = postgres(connectionString, {
  max: 10,
  ssl: 'require',
  // Bound the connect and let idle sockets live long enough to survive the gap between
  // bursts, so a warm cross-region connection is not torn down and re-established.
  connect_timeout: 30,
  idle_timeout: 60,
});

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

// Re-export schema for convenience
export * from './schema';

// Re-export pool utility for raw SQL queries
export { pool, query } from './utils';
