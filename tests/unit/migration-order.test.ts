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
});
