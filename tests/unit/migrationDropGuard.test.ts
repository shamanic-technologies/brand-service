import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GUARDRAIL — a destructive DROP of a user-data table must backfill into its
 * replacement in the SAME migration, or be explicitly acknowledged here.
 *
 * Incident (2026-07-21): `0041_drop_brand_profile_versions.sql` dropped the
 * table holding every user-CONFIRMED offer field while its sibling
 * `0042_brand_user_fields.sql` created the replacement EMPTY with no backfill.
 * Confirmed values were lost and only recovered post-hoc via Neon PITR
 * (see scripts/recover-brand-user-fields-from-pitr.ts).
 *
 * This test fails CI when a NEW migration `DROP`s a user-authored/durable table
 * unless the same file also backfills (`INSERT INTO ...`) OR the drop is listed
 * in ACKNOWLEDGED_DROPS with a recovery reference. Editing an already-applied
 * migration file changes its drizzle hash, so historical drops are acknowledged
 * here rather than annotated in-place.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

/** Tables that hold user-authored / durable data (not ephemeral caches). */
const USER_DATA_TABLES = [
  'brand_profile_versions',
  'brand_user_fields',
  'brand_sales_economics',
  'brand_thesis',
  'brand_individuals',
  'brand_click_destinations',
  'brand_whatsapp_links',
  'org_brands',
  'brands',
];

/**
 * Historical drops that predate this guardrail. Each MUST cite where the data
 * went (backfill/recovery) so the acknowledgement is auditable, never a silent
 * suppression.
 */
const ACKNOWLEDGED_DROPS: Record<string, string> = {
  '0041_drop_brand_profile_versions.sql':
    'PITR-recovered into brand_user_fields as CONFIRMED provenance; ' +
    'see scripts/recover-brand-user-fields-from-pitr.ts',
};

function dropTargets(sql: string): string[] {
  const hits: string[] = [];
  // DROP TABLE [IF EXISTS] "name" | name
  const re = /drop\s+table\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) hits.push(m[1].toLowerCase());
  return hits;
}

describe('migration drop guard', () => {
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    : [];

  it('has migrations to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const dropped = dropTargets(sql).filter((t) => USER_DATA_TABLES.includes(t));
    if (dropped.length === 0) continue;

    it(`${file}: dropping user-data table(s) [${dropped.join(', ')}] must backfill or be acknowledged`, () => {
      const hasInlineBackfill = /insert\s+into/i.test(sql);
      const isAcknowledged = Object.prototype.hasOwnProperty.call(
        ACKNOWLEDGED_DROPS,
        file,
      );
      expect(
        hasInlineBackfill || isAcknowledged,
        `Migration "${file}" DROPs user-data table(s) [${dropped.join(', ')}] ` +
          `without an in-file backfill (INSERT INTO ...) and is not in ` +
          `ACKNOWLEDGED_DROPS. A destructive drop that carries user data MUST ` +
          `backfill into its replacement BEFORE the drop.`,
      ).toBe(true);
    });
  }
});
