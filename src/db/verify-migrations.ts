import { sql } from 'drizzle-orm';

import { db } from './index';
import { countJournalEntries, migrationLedgerProblem } from '../lib/migration-ledger';

/**
 * Prove every migration in the journal actually ran, and refuse to report ready
 * otherwise.
 *
 * "Migrations complete" is exactly what drizzle logs after SKIPPING a file — it
 * resumes by row count against journal position, so a numbering gap makes it
 * slice past one and finish clean. `0046_brand_sales_funnel_declarations` was
 * skipped that way: production ran `0048` in its place, the count came out right,
 * and every sales-funnel read 500'd for ~19 hours (#416, #417).
 *
 * The comparison itself lives in `lib/migration-ledger` (no database import, so
 * it carries real unit tests). This is only the query around it.
 *
 * Call AFTER `migrate()`: before it, the ledger is legitimately behind.
 */
export async function assertEveryMigrationRan(migrationsFolder: string): Promise<void> {
  const journalEntries = countJournalEntries(migrationsFolder);
  const rows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`
  );
  const ledgerRows = Number(rows[0]?.count ?? NaN);
  if (!Number.isFinite(ledgerRows)) {
    throw new Error('[brand-service] could not read drizzle.__drizzle_migrations');
  }

  const problem = migrationLedgerProblem({ journalEntries, ledgerRows });
  if (problem) throw new Error(problem);

  console.log(
    `[brand-service] migration ledger verified: ${ledgerRows} applied, ${journalEntries} in the journal`
  );
}
