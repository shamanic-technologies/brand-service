import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';
import * as schema from './schema';

const connectionString = process.env.BRAND_SERVICE_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set');
}

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
