import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether every migration in the journal actually ran — the pure half.
 *
 * drizzle resumes by COUNTING the rows in `drizzle.__drizzle_migrations` and
 * slicing the journal from that offset. It never checks WHICH files those rows
 * correspond to. So if the count and the journal position ever disagree — a hole
 * in the numbering, a file added out of order, a hand-applied migration — the
 * slice starts in the wrong place, a file is skipped, and drizzle reports a clean
 * run. Nothing errors, the deploy goes green, and one table silently never gets
 * created.
 *
 * That is not hypothetical. `0046_brand_sales_funnel_declarations` was skipped
 * exactly this way: production ran `0048` in its place, the row count came out
 * right, and every sales-funnel read 500'd for ~19 hours before anyone connected
 * the two (#416, #417).
 *
 * Deliberately free of any database import, so the checks below carry real unit
 * tests rather than source-substring guards.
 */

export interface MigrationLedgerState {
  journalEntries: number;
  ledgerRows: number;
}

/**
 * How many migrations the journal says exist.
 *
 * Counts ENTRIES, never the highest `idx`. The two differ precisely when there
 * is a numbering gap, which is the situation this guard exists for — this repo's
 * own journal skips more than one idx, so counting the highest would overstate
 * and fail a healthy boot.
 */
export function countJournalEntries(migrationsFolder: string): number {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as { entries?: unknown[] };
  if (!Array.isArray(journal.entries)) {
    throw new Error(
      `[brand-service] migration journal at ${migrationsFolder} has no entries array`
    );
  }
  return journal.entries.length;
}

/**
 * The message a short ledger produces, or null when everything ran.
 *
 * A COUNT comparison rather than a per-file hash, and that is deliberate.
 * Hashing each file against the ledger sounds stricter and is unusable here:
 * this repo's convention is to sed-edit a generated migration for idempotency
 * (`CREATE TABLE` -> `CREATE TABLE IF NOT EXISTS`), which can land AFTER the file
 * has already been applied somewhere. Run against production on 2026-08-02, a
 * hash sweep flagged FIVE migrations as missing when only ONE genuinely was —
 * four false positives on healthy files. A guard that refuses to boot on those is
 * worse than no guard.
 *
 * Counting is enough for the failure this catches: a skipped file leaves the
 * ledger permanently one row short, and no amount of later editing changes that.
 *
 * A ledger LONGER than the journal is NOT an error — that is what a rolled-back
 * deploy looks like from here, and the extra rows are migrations a newer build
 * applied. Failing on it would turn every rollback into an outage, and a rollback
 * is what you reach for when you already have one.
 */
export function migrationLedgerProblem(state: MigrationLedgerState): string | null {
  const { journalEntries, ledgerRows } = state;
  if (ledgerRows >= journalEntries) return null;
  const skipped = journalEntries - ledgerRows;
  return (
    `[brand-service] ${skipped} migration(s) in the journal never ran: the journal has ` +
    `${journalEntries} entries and drizzle.__drizzle_migrations has ${ledgerRows} rows. ` +
    `drizzle resumes by row COUNT against journal POSITION, so a gap means it sliced past ` +
    `a file and reported success. Find the missing one by hashing each drizzle/*.sql against ` +
    `the ledger, apply it, then stamp its hash. Refusing to serve on a schema that is not ` +
    `the one this build expects.`
  );
}
