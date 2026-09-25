/**
 * ONE-TIME MOVE — conversion rates go from the OFFER grain to the BRAND grain.
 *
 * Owner-decided 2026-09-25: a conversion rate describes how a brand sells, so
 * there is ONE stated rate per (org, brand, funnel, arrow), shared by every
 * offer of the brand. This copies today's per-offer statements up into
 * `brand_funnel_arrow_rates`. The per-offer rates are READ only and left exactly
 * where they are; every current reader keeps its answer.
 *
 * WHAT COUNTS AS STATED — exactly what the per-offer read serves: an arrow row
 *   wins over the named column describing the same arrow, the named column is
 *   the fallback. EXCEPT a value that may be a legacy NOT NULL server default of
 *   `brand_sales_economics` copied onto a funnel by the economics backfill (see
 *   `LEGACY_SERVER_DEFAULTS`): that is the database filling a column nobody
 *   wrote, not a statement, and it is set aside and listed.
 * WHO WINS — per (org, brand, funnel, arrow), the most recently stated value
 *   among the brand's offers. A tie on the moment breaks on the offer id.
 *   Differing values are CONFLICTS and are printed.
 * NOTHING IS INVENTED — an arrow no offer stated gets NO row. No null, no default.
 * NEVER OVERWRITES — a rate already stated at the brand grain conflicts away
 *   untouched (`ON CONFLICT DO NOTHING`), which also makes a re-run a no-op.
 * REVERSIBLE — every row carries `migrated_at` + `migrated_from_offer_id`:
 *     DELETE FROM brand_funnel_arrow_rates WHERE migrated_at IS NOT NULL;
 *   (a rate a caller restated since clears both, so it survives the undo.)
 *
 * Usage (inside the brand-service container):
 *   npx tsx scripts/migrate-funnel-rates-to-brand.ts --dry-run
 *   npx tsx scripts/migrate-funnel-rates-to-brand.ts
 *
 * Read the result back from the table, not from this log:
 *   SELECT count(*), count(*) FILTER (WHERE rate_pct IS NULL)
 *     FROM brand_funnel_arrow_rates WHERE migrated_at IS NOT NULL;
 */

import {
  applyMigrationPlan,
  countMigratedRows,
  planMigrationFromDatabase,
} from '../src/services/brandFunnelRatesService';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const plan = await planMigrationFromDatabase();

  const brands = new Set(plan.writes.map((w) => `${w.orgId}/${w.brandId}`));
  console.log(`[migrate-funnel-rates] ${plan.writes.length} brand-grain rates across ${brands.size} (org, brand) pairs`);
  console.log(`[migrate-funnel-rates] ${plan.conflicts.length} conflicts`);
  for (const c of plan.conflicts) {
    console.log(
      `  CONFLICT org=${c.orgId} brand=${c.brandId} ${c.funnelKey} "${c.fromStep}" -> "${c.toStep}": ` +
        `winner ${c.winner.ratePct}% (offer ${c.winner.offerId}, ${c.winner.statedAt}); ` +
        c.losers.map((l) => `lost ${l.ratePct}% (offer ${l.offerId}, ${l.statedAt})`).join('; ')
    );
  }
  console.log(`[migrate-funnel-rates] ${plan.droppedAsLegacyDefault.length} values set aside as a possible legacy server default`);
  for (const d of plan.droppedAsLegacyDefault) {
    console.log(`  DEFAULT org=${d.orgId} brand=${d.brandId} offer=${d.offerId} ${d.funnelKey} "${d.fromStep}" -> "${d.toStep}" = ${d.ratePct}%`);
  }
  if (plan.writes.some((w) => w.ratePct === null || Number.isNaN(Number(w.ratePct)))) {
    throw new Error('A planned write carries no number; refusing to write anything.');
  }

  if (dryRun) {
    console.log('[migrate-funnel-rates] --dry-run: nothing written');
    return;
  }
  const inserted = await applyMigrationPlan(plan);
  console.log(`[migrate-funnel-rates] inserted ${inserted}; table now holds ${await countMigratedRows()} migrated rows`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate-funnel-rates] FAILED', error);
    process.exit(1);
  });
