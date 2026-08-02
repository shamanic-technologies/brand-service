/**
 * ONE-TIME BACKFILL — give every brand that carries a retired goal the sales
 * funnel declaration that goal MEANT.
 *
 * The goal vocabulary is retired: what a brand sells through is its declared
 * funnels, and that is the only vocabulary brand-service emits. A brand that
 * only ever carried a goal would read back as "has never answered", so anything
 * ranking on the declaration would stop working for it. This inverts the goal
 * once, so nothing that was running stops running.
 *
 * The mapping is `funnelKeysForRetiredGoal` — the SAME function the write
 * acceptors apply, so a brand lands on the same declaration whichever way its
 * goal arrived, and the mapping cannot drift from the one the service enforces.
 *
 * IDEMPOTENT — an (org, brand) pair that already has ANY funnel row is skipped
 * whole. It has answered, whatever it answered, and this must never edit that.
 * REVERSIBLE — every row written carries `backfilled_from_goal`, so undoing is
 *   DELETE FROM brand_sales_funnels WHERE backfilled_from_goal IS NOT NULL;
 * exactly, with no timestamp window and no risk of taking a user's row with it.
 * DRY-RUNNABLE — `--dry-run` reads and prints the plan, writes nothing.
 *
 * Usage:
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-funnel-declarations.ts --dry-run
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-funnel-declarations.ts
 *
 * The counts this prints are the SCRIPT'S OWN LOG and are not the result. Read
 * the result back from the database:
 *   SELECT backfilled_from_goal, funnel_key, count(*)
 *     FROM brand_sales_funnels WHERE backfilled_from_goal IS NOT NULL
 *    GROUP BY 1, 2;
 * A re-run legitimately reports zero of everything, which is indistinguishable
 * from "it did nothing" in the log alone.
 */

import { sql } from 'drizzle-orm';
import { db, brandSalesFunnels } from '../src/db';
import {
  planBackfill,
  type BackfillCandidate,
  type BackfillPlan,
} from '../src/lib/funnel-backfill-plan';

async function readCandidates(): Promise<BackfillCandidate[]> {
  const rows = await db.execute<{
    org_id: string;
    brand_id: string;
    current_goal: string;
    has_domain: boolean;
    has_click_destination: boolean;
  }>(sql`
    SELECT ob.org_id,
           ob.brand_id,
           ob.current_goal,
           (b.domain IS NOT NULL) AS has_domain,
           (cd.brand_id IS NOT NULL) AS has_click_destination
      FROM org_brands ob
      JOIN brands b ON b.id = ob.brand_id
      LEFT JOIN brand_click_destinations cd
        ON cd.brand_id = ob.brand_id AND cd.org_id = ob.org_id
     WHERE ob.current_goal IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM brand_sales_funnels f
          WHERE f.org_id = ob.org_id AND f.brand_id = ob.brand_id
       )
     ORDER BY ob.claimed_at, ob.brand_id
  `);

  return [...rows].map((r) => ({
    orgId: r.org_id,
    brandId: r.brand_id,
    currentGoal: r.current_goal,
    hasDomain: r.has_domain,
    hasClickDestination: r.has_click_destination,
  }));
}

function summarise(plan: BackfillPlan): void {
  const byGoal = new Map<string, number>();
  for (const row of plan.rows) {
    const key = `${row.backfilledFromGoal} -> ${row.funnelKey}`;
    byGoal.set(key, (byGoal.get(key) ?? 0) + 1);
  }
  console.log(`\nrows to write: ${plan.rows.length}`);
  for (const [key, count] of [...byGoal].sort()) {
    console.log(`  ${key}: ${count}`);
  }
  if (plan.skipped.length > 0) {
    console.log(`\nskipped: ${plan.skipped.length}`);
    const byReason = new Map<string, number>();
    for (const s of plan.skipped) {
      const key = `${s.candidate.currentGoal} (${s.reason}${s.funnelKey ? `: ${s.funnelKey}` : ''})`;
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...byReason].sort()) {
      console.log(`  ${key}: ${count}`);
    }
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const candidates = await readCandidates();
  console.log(`(org, brand) pairs carrying a goal with no declaration: ${candidates.length}`);

  const plan = planBackfill(candidates);
  summarise(plan);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  // Chunked: one statement per ~500 rows. A bulk insert binds one parameter per
  // column per row and Postgres caps a statement at 65,534 of them, so an insert
  // whose size is set by how many brands exist is a bomb with a date on it.
  const CHUNK = 500;
  for (let i = 0; i < plan.rows.length; i += CHUNK) {
    await db
      .insert(brandSalesFunnels)
      .values(
        plan.rows.slice(i, i + CHUNK).map((row) => ({
          orgId: row.orgId,
          brandId: row.brandId,
          funnelKey: row.funnelKey,
          active: true,
          backfilledFromGoal: row.backfilledFromGoal,
        }))
      )
      // Belt and braces on top of the "pair has no rows at all" filter: a row
      // that appeared between the read and the write is left exactly as it is.
      .onConflictDoNothing();
  }

  // Read the result back rather than reporting what we intended to write.
  const written = await db.execute<{ backfilled_from_goal: string; funnel_key: string; n: string }>(sql`
    SELECT backfilled_from_goal, funnel_key, count(*)::text AS n
      FROM brand_sales_funnels
     WHERE backfilled_from_goal IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);
  console.log('\nread back from the database (all backfilled rows, not just this run):');
  for (const row of written) {
    console.log(`  ${row.backfilled_from_goal} -> ${row.funnel_key}: ${row.n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
