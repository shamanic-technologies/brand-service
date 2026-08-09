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

// TLS is REQUIRED unless the connection string says otherwise IN SO MANY WORDS.
// Every database this service talks to for real is remote and must be encrypted,
// so `require` stays the default and no host pattern (localhost, a private IP, a
// docker service name) is ever allowed to turn it off on its own — a heuristic
// like that silently drops TLS the day a remote host resolves to something that
// looks local. The one caller that legitimately has no TLS at all is CI's
// throwaway `postgres:16` service container, which states it: `?sslmode=disable`.
// Without this, every query there dies as `Client network socket disconnected
// before secure TLS connection was established`.
export function sslOptionFor(dsn: string): 'require' | false {
  return /[?&]sslmode=disable(&|$)/.test(dsn) ? false : 'require';
}

// Create postgres client for Drizzle
const client = postgres(connectionString, {
  max: 10,
  ssl: sslOptionFor(connectionString),
});

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

// Re-export schema for convenience
export * from './schema';

// Re-export pool utility for raw SQL queries
export { pool, query } from './utils';
