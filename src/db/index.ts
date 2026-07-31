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
// candidate only 250ms. The database lives in ap-southeast-1, and a compute that is far
// away — or resuming from scale-to-zero, which every CI branch is — does not always answer
// inside that budget, so every candidate loses and the whole connect fails with
// `AggregateError [ETIMEDOUT]`. The query never dispatched, so nothing is half-applied.
//
// This is a connect-phase failure, not a slow query: the stack bottoms out in
// `internalConnectMultipleTimeout (node:net)`, never in query execution. Do not go looking
// for a missing index.
//
// Observed as flaky mid-suite CI failures (a different file each run). The production
// compute is set to never suspend, so it is not exposed to the resume case; this bounds the
// distance case for every environment.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

// Create postgres client for Drizzle
const client = postgres(connectionString, {
  max: 10,
  ssl: 'require',
});

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

// Re-export schema for convenience
export * from './schema';

// Re-export pool utility for raw SQL queries
export { pool, query } from './utils';
