import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { orgBrands } from '../../src/db/schema';

/**
 * "This org has not said what it optimizes for" must stay representable.
 *
 * `org_brands.current_goal` used to carry a DEFAULT of a real goal. That made a
 * row nobody had told a goal identical to one that had chosen website purchase,
 * so every read answered a plausible goal for a brand that had never picked one.
 *
 * It cost six weeks: the column landed 2026-06-17 with that default and no
 * backfill of the goals brands had already chosen, so 14 brands that chose sales
 * meetings were served website purchase and their campaigns optimized for it.
 * The rows were repaired 2026-08-01; migration 0052 removed the default that
 * produced them.
 *
 * These assertions read the drizzle column definition rather than the source
 * text, so they hold however the column is spelled.
 */
describe('a goal nobody chose is not a goal', () => {
  const column = orgBrands.currentGoal as unknown as {
    notNull: boolean;
    hasDefault: boolean;
    default: unknown;
  };

  it('carries no default — a default here is a fabricated answer', () => {
    expect(column.hasDefault).toBe(false);
    expect(column.default).toBeUndefined();
  });

  it('is nullable, so "not said" has somewhere to live', () => {
    // All four `org_brands` inserts omit the goal. With a NOT NULL column and no
    // default they would fail; with a default they would lie. Nullable is what
    // lets them state the truth.
    expect(column.notNull).toBe(false);
  });

  it('never re-introduces a default in the schema source', () => {
    // Belt and braces: the assertions above read the parsed column, this one
    // catches a `.default(...)` added back on the same line.
    const src = readFileSync(join(__dirname, '../../src/db/schema.ts'), 'utf8');
    const line = src
      .split('\n')
      .find((l) => l.includes('text("current_goal")'));
    expect(line).toBeDefined();
    expect(line).not.toContain('.default(');
    expect(line).not.toContain('.notNull()');
  });
});

describe('the migration that removed it', () => {
  const sql = readFileSync(
    join(__dirname, '../../drizzle/0053_goal_never_chosen.sql'),
    'utf8'
  );

  it('drops both the default and the not-null constraint', () => {
    // Dropping only the default would break brand creation: every insert omits
    // the goal. Dropping only NOT NULL would leave the fabricated value in place.
    expect(sql).toContain('DROP DEFAULT');
    expect(sql).toContain('DROP NOT NULL');
  });

  it('leaves existing rows alone', () => {
    // Which stored values were deliberate and which were the default is no
    // longer recoverable. Guessing would re-create the problem in the other
    // direction, so this migration only stops it going forward.
    expect(sql).not.toContain('UPDATE');
    expect(sql).not.toContain('DELETE');
  });
});
