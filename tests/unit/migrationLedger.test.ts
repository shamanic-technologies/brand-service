import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  countJournalEntries,
  migrationLedgerProblem,
} from '../../src/lib/migration-ledger';

/**
 * drizzle resumes by COUNTING ledger rows and slicing the journal from that
 * offset — it never checks which files those rows are. A numbering gap therefore
 * makes it slice past a file, skip it, and report a clean run.
 *
 * `0046_brand_sales_funnel_declarations` was skipped exactly this way: production
 * ran `0048` in its place, the count came out right, the deploy went green, and
 * every sales-funnel read 500'd for ~19 hours (#416, #417).
 */
describe('a short ledger means a migration was skipped', () => {
  it('says nothing when every migration ran', () => {
    expect(migrationLedgerProblem({ journalEntries: 53, ledgerRows: 53 })).toBeNull();
  });

  it('names the shortfall when the ledger is behind', () => {
    const problem = migrationLedgerProblem({ journalEntries: 53, ledgerRows: 52 });
    expect(problem).toContain('1 migration(s) in the journal never ran');
    expect(problem).toContain('53 entries');
    expect(problem).toContain('52 rows');
  });

  it('counts more than one skipped file', () => {
    expect(migrationLedgerProblem({ journalEntries: 53, ledgerRows: 50 })).toContain(
      '3 migration(s)'
    );
  });

  it('accepts a ledger LONGER than the journal — that is a rolled-back deploy', () => {
    // The extra rows are migrations a newer build applied. Refusing to boot here
    // would turn every rollback into an outage, and a rollback is the thing you
    // reach for WHEN you already have one.
    expect(migrationLedgerProblem({ journalEntries: 50, ledgerRows: 53 })).toBeNull();
  });

  it('explains the count-versus-position mechanism, not just the numbers', () => {
    // The message is read by whoever is paged at 3am. "53 != 52" tells them
    // nothing actionable; the mechanism and the next step do.
    const problem = migrationLedgerProblem({ journalEntries: 53, ledgerRows: 52 })!;
    expect(problem).toContain('row COUNT against journal POSITION');
    expect(problem).toContain('hashing each drizzle/*.sql against the ledger');
  });
});

describe('countJournalEntries', () => {
  const folderWith = (journal: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
    mkdirSync(join(dir, 'meta'));
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
    return dir;
  };

  it('counts entries, not the highest idx', () => {
    // The two differ precisely when there is a numbering gap — which is the
    // situation this whole guard exists for. brand-service's own journal skips
    // idx 47 and 53, so counting the highest idx would overstate by two and
    // fail a perfectly healthy boot.
    const dir = folderWith({
      entries: [
        { idx: 0, tag: '0000_a' },
        { idx: 1, tag: '0001_b' },
        { idx: 3, tag: '0003_c' },
      ],
    });
    expect(countJournalEntries(dir)).toBe(3);
  });

  it('throws on a journal with no entries array rather than reporting zero', () => {
    // Zero would compare as "ledger is ahead", which reads as healthy. An
    // unreadable journal is a broken build, and it must say so.
    const dir = folderWith({ version: '7' });
    expect(() => countJournalEntries(dir)).toThrow(/no entries array/);
  });
});
