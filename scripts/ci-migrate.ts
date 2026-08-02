/**
 * Apply the migration files to CI's throwaway Neon branch, exactly the way a
 * deploy does.
 *
 * CI branches off the project's default branch, so it starts on PRODUCTION's
 * schema and its drizzle ledger, not on an empty database. `drizzle-kit push`
 * therefore has to DIFF, and a diff that both adds a column and rekeys the
 * table on it emits the two statements in the wrong order — it tried to make
 * `(org_id, brand_id)` the key of `brand_business_context` before `org_id`
 * existed, and the whole push aborted, leaving every table it had not reached
 * yet on the old schema.
 *
 * Running the migrations first is not a workaround for that: it is what
 * staging and production actually do, so it is the ordering the repo already
 * has to be correct about. Push still runs afterwards and stays the authority
 * on `schema.ts` drift — it just has nothing structural left to reconcile.
 *
 * It also closes a real gap. Until now the migration SQL was never executed in
 * CI at all, which is how #386's stranded migration reached production green:
 * the suite builds its schema from `schema.ts` and would have passed either
 * way.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.BRAND_SERVICE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set');
  process.exit(1);
}

async function main() {
  // `max: 1` because the migrator runs one statement at a time and a second
  // connection would only race it.
  const client = postgres(url!, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('Migrations applied');
  } finally {
    await client.end();
  }
}

// Loud and fatal: a migration that cannot apply to a fresh copy of production
// is the exact failure this step exists to catch, and letting the suite run on
// a half-migrated schema would report it as a dozen unrelated test failures
// instead.
main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
