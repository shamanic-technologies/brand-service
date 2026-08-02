import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * A migration authored on a branch must stamp ABOVE every migration already on
 * `main`, because `main` is what production has applied.
 *
 * The runtime migrator only applies entries stamped above the last one it
 * recorded, so a new migration stamped below production's tail is skipped there
 * — permanently, and with no error anywhere. `migration-order.test.ts` cannot
 * see this: it reads the journal against itself, and the journal stays
 * perfectly sorted the whole time. The hole exists only relative to what
 * production already recorded.
 *
 * That comparison looked like it needed the deployed ledger, which no test can
 * reach. It does not: `main` IS the set production has applied, and git has it.
 * So the check is local after all.
 *
 * It fires on the migrations this branch ADDS. Anything already on `main` is
 * left alone — it has been applied, its stamp is history, and re-stamping an
 * applied migration changes the hash the ledger stores.
 */

type Entry = { idx: number; when: number; tag: string };

const drizzleDir = path.resolve(__dirname, '../../drizzle');

function readJournal(json: string): Entry[] {
  return JSON.parse(json).entries as Entry[];
}

/**
 * Fails loudly rather than skipping when `main` is unreachable. A guard that
 * quietly does nothing on a misconfigured checkout is the failure mode this
 * exists to prevent, so "I could not check" must never read as "it passed".
 */
function journalOnMain(): Entry[] {
  const candidates = ['origin/main', 'main'];
  const failures: string[] = [];
  for (const ref of candidates) {
    try {
      const out = execFileSync('git', ['show', `${ref}:drizzle/meta/_journal.json`], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return readJournal(out);
    } catch (error) {
      failures.push(`${ref}: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `Could not read the migration journal from main, so a stranded migration cannot be ruled out. ` +
    `In CI, fetch main before running this (actions/checkout does a shallow single-branch clone by ` +
    `default). Tried — ${failures.join(' | ')}`,
  );
}

describe('migration stamps against main', () => {
  it('stamps every migration this branch adds above everything main already has', () => {
    const local = readJournal(fs.readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf-8'));
    const onMain = journalOnMain();

    // Nothing on main yet (a fresh repo) means nothing can be stranded.
    if (onMain.length === 0) return;

    const mainTags = new Set(onMain.map((e) => e.tag));
    const added = local.filter((e) => !mainTags.has(e.tag));
    if (added.length === 0) return;

    const highestOnMain = onMain.reduce((max, e) => (e.when > max.when ? e : max), onMain[0]);

    for (const entry of added) {
      expect(
        entry.when,
        `Migration "${entry.tag}" is new on this branch but stamped ${entry.when}, which is not above ` +
        `"${highestOnMain.tag}" (${highestOnMain.when}) — already on main, so production has applied it. ` +
        `The runtime migrator only applies stamps above the last one it recorded, so this migration would ` +
        `be skipped in production forever, silently: the journal stays sorted, CI builds its schema from ` +
        `schema.ts, and nothing reports a pending migration. Raise this migration's "when" above ` +
        `${highestOnMain.when} (and renumber its file to match its new position). Safe to restamp because ` +
        `it has not been applied anywhere yet — never restamp one that has.`,
      ).toBeGreaterThan(highestOnMain.when);
    }
  });
});
