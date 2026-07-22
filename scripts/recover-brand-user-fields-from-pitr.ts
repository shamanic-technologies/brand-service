/**
 * One-shot, idempotent recovery of user-confirmed offer fields from a Neon
 * point-in-time-restore (PITR) branch into `brand_user_fields`.
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #349 shipped the 2-layer brand-fields model. Its migration
 * `0041_drop_brand_profile_versions.sql` ran `DROP TABLE ... CASCADE` on
 * `brand_profile_versions` — the table that held every user-confirmed offer
 * field (the Alex-Hormozi value-equation levers users validate on the
 * dashboard strategy page). The sibling migration `0042_brand_user_fields.sql`
 * created the replacement table EMPTY, with no `INSERT ... SELECT` backfill.
 * Result: confirmed values were lost; the strategy page rendered every field
 * as amber "AI-suggested" instead of the user's confirmed values.
 *
 * The dropped rows were recovered by branching production to a pre-drop
 * timestamp (Neon PITR, 24h retention window) and re-inserting the latest
 * confirmed version per brand into `brand_user_fields` as CONFIRMED provenance.
 * This script encodes that transformation so it is reproducible and auditable.
 *
 * MAPPING
 * -------
 *  - The old store kept a per-brand versioned `fields` jsonb blob. For each of
 *    the 7 user-facing keys we take the value from the LATEST version that has
 *    a non-empty value for THAT key (per-field, not per-row) — because a later
 *    version can be a partial snapshot that omits a field the user confirmed in
 *    an earlier version (e.g. `services` present in v1, absent in v2). Taking
 *    the latest version wholesale would silently drop those fields.
 *  - The user-facing key `valueProposition` was RENAMED to `dreamOutcome`
 *    (see brandUserFieldsService.USER_FACING_FIELD_KEYS). We map the old
 *    `valueProposition` value onto the new `dreamOutcome` key. A pre-existing
 *    `dreamOutcome` value (should any exist) wins over `valueProposition`.
 *  - List-kind fields (`services`, `socialProof`) keep their JSON array shape;
 *    string-kind fields keep their JSON string shape (the jsonb value is copied
 *    verbatim, so both are preserved).
 *  - `confirmed_at` is set to the source row's `created_at` (when the user
 *    actually confirmed), not now().
 *
 * SAFETY / IDEMPOTENCE
 * --------------------
 *  - Only brands that still exist in the TARGET `brands` table are written
 *    (FK-safe inner join) — deleted brands are skipped.
 *  - `ON CONFLICT (brand_id, field_key) DO NOTHING` — a value a user has
 *    RE-CONFIRMED since the drop (a newer row) is never overwritten. Re-running
 *    the script is a no-op.
 *  - It NEVER touches `brand_extracted_fields` (the ephemeral suggested layer).
 *  - Empty / null / whitespace-only values are skipped.
 *
 * USAGE
 * -----
 *   RECOVERY_DATABASE_URL=<postgres url of the PITR branch that still has
 *                          brand_profile_versions>
 *   BRAND_SERVICE_DATABASE_URL=<postgres url of the target (production) db>
 *   pnpm recover:brand-user-fields          # dry-run: prints counts, writes nothing
 *   pnpm recover:brand-user-fields --commit  # performs the insert
 */
import postgres from 'postgres';
import 'dotenv/config';

const RECOVERY_URL = process.env.RECOVERY_DATABASE_URL;
const TARGET_URL =
  process.env.BRAND_SERVICE_DATABASE_URL || process.env.DATABASE_URL;
const COMMIT = process.argv.includes('--commit');

if (!RECOVERY_URL) {
  throw new Error(
    'RECOVERY_DATABASE_URL must be set (the PITR branch that still holds brand_profile_versions)',
  );
}
if (!TARGET_URL) {
  throw new Error('BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set (target db)');
}

/** The 7 user-facing keys, paired with the source key in the old fields blob. */
const KEY_MAP: ReadonlyArray<{ target: string; sourceKeys: string[] }> = [
  { target: 'services', sourceKeys: ['services'] },
  { target: 'dreamOutcome', sourceKeys: ['dreamOutcome', 'valueProposition'] },
  { target: 'perceivedLikelihood', sourceKeys: ['perceivedLikelihood'] },
  { target: 'socialProof', sourceKeys: ['socialProof'] },
  { target: 'riskReversal', sourceKeys: ['riskReversal'] },
  { target: 'urgency', sourceKeys: ['urgency'] },
  { target: 'scarcity', sourceKeys: ['scarcity'] },
];

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

interface RecoveredRow {
  brandId: string;
  fieldKey: string;
  value: unknown;
  confirmedAt: string;
}

async function main() {
  const source = postgres(RECOVERY_URL!, { max: 4, ssl: 'require' });
  const target = postgres(TARGET_URL!, { max: 4, ssl: 'require' });

  try {
    // All versions, newest-first, so we can pick the latest non-empty value
    // PER FIELD (a later version may omit a field an earlier one confirmed).
    const versions = await source<
      { brand_id: string; created_at: string; fields: Record<string, unknown> }[]
    >`
      SELECT brand_id, created_at, fields
      FROM brand_profile_versions
      ORDER BY brand_id, version DESC, created_at DESC
    `;

    // key = `${brandId}::${fieldKey}` → first (newest) non-empty wins.
    const picked = new Map<string, RecoveredRow>();
    for (const row of versions) {
      for (const { target: fieldKey, sourceKeys } of KEY_MAP) {
        const mapKey = `${row.brand_id}::${fieldKey}`;
        if (picked.has(mapKey)) continue; // newer version already supplied it
        let value: unknown;
        for (const sk of sourceKeys) {
          if (row.fields[sk] !== undefined && !isEmpty(row.fields[sk])) {
            value = row.fields[sk];
            break;
          }
        }
        if (isEmpty(value)) continue;
        picked.set(mapKey, {
          brandId: row.brand_id,
          fieldKey,
          value,
          confirmedAt: row.created_at,
        });
      }
    }

    const recovered: RecoveredRow[] = [...picked.values()];
    const brandCount = new Set(recovered.map((r) => r.brandId)).size;
    console.log(
      `Recovered ${recovered.length} field values across ${brandCount} brands from the PITR source.`,
    );

    if (!COMMIT) {
      console.log('DRY RUN (pass --commit to write). No rows inserted.');
      return;
    }

    // FK-safe, idempotent insert. Skip brands absent from the target; never
    // overwrite a value the user re-confirmed after the drop.
    let inserted = 0;
    let skippedFk = 0;
    for (const r of recovered) {
      const [{ exists }] = await target<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM brands WHERE id = ${r.brandId}) AS exists
      `;
      if (!exists) {
        skippedFk += 1;
        continue;
      }
      const res = await target`
        INSERT INTO brand_user_fields (brand_id, field_key, value, confirmed_at)
        VALUES (${r.brandId}, ${r.fieldKey}, ${target.json(r.value as never)}, ${r.confirmedAt})
        ON CONFLICT (brand_id, field_key) DO NOTHING
      `;
      inserted += res.count;
    }

    console.log(
      `Inserted ${inserted} rows (skipped ${skippedFk} for deleted brands, ` +
        `${recovered.length - inserted - skippedFk} already present).`,
    );
  } finally {
    await source.end({ timeout: 5 });
    await target.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
