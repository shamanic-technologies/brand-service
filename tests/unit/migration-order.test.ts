import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Drizzle migration journal', () => {
  it('should have strictly increasing "when" timestamps so Drizzle applies all migrations', () => {
    const journalPath = path.resolve(__dirname, '../../drizzle/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));

    const entries = journal.entries as Array<{ idx: number; when: number; tag: string }>;
    expect(entries.length).toBeGreaterThan(0);

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      expect(
        curr.when,
        `Migration "${curr.tag}" (idx ${curr.idx}) has "when" ${curr.when} which is not greater than ` +
        `"${prev.tag}" (idx ${prev.idx}) "when" ${prev.when}. ` +
        `Drizzle silently skips migrations with a "when" <= the last applied migration's timestamp.`,
      ).toBeGreaterThan(prev.when);
    }
  });

  // The ordering check above passes even when a migration is unreachable in one
  // environment, because it only ever reads the journal against itself. That is what
  // happened to 0046: a hotfix authored 0048 on `main` and production applied it, while
  // 0046 sat unpromoted on `staging` with an earlier stamp; promoting inserted 0046 into
  // the middle of an already-sorted journal, below a bar production had cleared, so it
  // never ran there. Every journal stayed sorted throughout — the hole is only visible
  // against the deployed `drizzle.__drizzle_migrations` ledger, which no unit test sees.
  //
  // So this asserts the part that IS local: the journal and the migration files describe
  // the same set. A hand-authored migration (the usual fix for the above) that adds a
  // .sql without its journal entry never runs anywhere, and a journal entry without its
  // .sql throws at boot.
  it('names exactly the migration files on disk, so no migration is stranded either way', () => {
    const drizzleDir = path.resolve(__dirname, '../../drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf-8'));

    const tagged = (journal.entries as Array<{ tag: string }>).map((e) => e.tag).sort();
    const onDisk = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();

    expect(
      onDisk,
      'Every .sql in drizzle/ must have a journal entry and vice versa. A file with no entry ' +
      'is never applied; an entry with no file throws at boot.',
    ).toEqual(tagged);
  });
});
