/**
 * ONE-TIME BACKFILL — put the numbers a brand stated BEFORE the funnel model
 * existed onto the funnel(s) that replaced them.
 *
 * The goal→funnel backfill (`backfill-funnel-declarations.ts`) gave every brand
 * carrying a retired goal the declaration that goal meant, carrying the funnel
 * key and its provenance and nothing else. The rates and the lifetime revenue
 * those brands had already entered were — and still are — untouched on
 * `brand_sales_economics`, the brand-wide record the funnel model replaced. So
 * Settings shows every field empty on a funnel the customer had priced.
 *
 * This copies them across. The mapping is `ratesForFunnel`: a leg of the
 * funnel's own chain is filled from the economics column of the SAME name, and
 * nothing else is written. `meetingBookedToAttendedPct` has no counterpart —
 * it was never stated anywhere — so it stays NULL rather than being invented.
 *
 * IDEMPOTENT — only a declaration the goal backfill created, that holds NO
 *   number at all and has not already been filled, is a candidate. A second run
 *   finds none.
 * NEVER OVERWRITES — a funnel a human priced is excluded by the same predicate,
 *   and so is one this backfill already touched.
 * REVERSIBLE — every row it writes carries `economics_backfilled_at`, so undoing
 *   is an exact predicate with no timestamp window:
 *     UPDATE brand_sales_funnels
 *        SET lifetime_revenue_usd = NULL, reply_to_meeting_pct = NULL,
 *            visit_to_meeting_pct = NULL, meeting_to_close_pct = NULL,
 *            visit_to_signup_pct = NULL, signup_to_paid_client_pct = NULL,
 *            visit_to_form_submission_pct = NULL,
 *            form_submission_to_paid_client_pct = NULL,
 *            economics_backfilled_at = NULL
 *      WHERE economics_backfilled_at IS NOT NULL;
 * DRY-RUNNABLE — `--dry-run` reads and prints the plan, writes nothing.
 *
 * Usage:
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-funnel-economics.ts --dry-run
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-funnel-economics.ts
 *
 * The counts this prints are the SCRIPT'S OWN LOG and are not the result. Read
 * the result back from the database:
 *   SELECT funnel_key, count(*)
 *     FROM brand_sales_funnels WHERE economics_backfilled_at IS NOT NULL
 *    GROUP BY 1;
 * A re-run legitimately reports zero of everything, which is indistinguishable
 * from "it did nothing" in the log alone.
 */

import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { planEconomicsBackfill, type EconomicsBackfillPlan } from '../src/lib/funnel-economics-backfill-plan';
import {
  applyEconomicsBackfill,
  readEconomicsBackfillCandidates,
} from '../src/services/funnelEconomicsBackfillService';

function summarise(plan: EconomicsBackfillPlan): void {
  const byFunnel = new Map<string, number>();
  for (const row of plan.rows) {
    byFunnel.set(row.funnelKey, (byFunnel.get(row.funnelKey) ?? 0) + 1);
  }
  console.log(`\nfunnels to fill: ${plan.rows.length}`);
  for (const [key, count] of [...byFunnel].sort()) {
    console.log(`  ${key}: ${count}`);
  }
  console.log(`brands touched: ${new Set(plan.rows.map((r) => r.brandId)).size}`);

  if (plan.skipped.length > 0) {
    console.log(`\nskipped: ${plan.skipped.length}`);
    const byReason = new Map<string, number>();
    for (const s of plan.skipped) {
      byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    }
    for (const [key, count] of [...byReason].sort()) {
      console.log(`  ${key}: ${count}`);
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const candidates = await readEconomicsBackfillCandidates();
  console.log(`unpriced backfilled declarations whose brand stated economics: ${candidates.length}`);

  const plan = planEconomicsBackfill(candidates);
  summarise(plan);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  await applyEconomicsBackfill(plan);

  // Read the result back rather than reporting what we intended to write.
  const written = await db.execute<{ funnel_key: string; n: string; brands: string }>(sql`
    SELECT funnel_key,
           count(*)::text AS n,
           count(DISTINCT brand_id)::text AS brands
      FROM brand_sales_funnels
     WHERE economics_backfilled_at IS NOT NULL
     GROUP BY 1
     ORDER BY 1
  `);
  console.log('\nread back from the database (all filled rows, not just this run):');
  for (const row of written) {
    console.log(`  ${row.funnel_key}: ${row.n} rows across ${row.brands} brands`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
