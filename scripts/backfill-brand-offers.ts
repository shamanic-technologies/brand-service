/**
 * ONE-TIME MIGRATION — give every brand that already sells something the single
 * OFFER that carries all of it.
 *
 * The offer is the new level between a brand and a campaign. Conversion rates, a
 * lifetime revenue and a value proposition describe ONE thing a brand sells, and
 * until now they hung off the brand — so a brand selling a $200 self-serve plan
 * and a $20k contract had to describe both as one thing. `brand_sales_funnels`
 * and `brand_user_fields` now hang off `brand_offers`, and this fills that
 * column for everything that existed before it did.
 *
 * WHAT IT WRITES: one `brand_offers` row per (org, brand) pair holding rows no
 *   offer owns yet, and the offer's id onto exactly those rows. NOTHING ELSE IS
 *   TOUCHED — not a rate, not a lifetime revenue, not a confirmed field, not a
 *   destination. Every brand-scoped read answers byte-for-byte what it answered
 *   before, because the same rows are still there and the resolver finds the
 *   brand's one offer.
 *
 * THE NAME is generated from what the brand ITSELF stated — its confirmed value
 *   proposition, the services it listed, the funnels it sells through — through
 *   chat-service (platform-billed; chat-service owns the model, the key and the
 *   token cost). At most 2 words, at most 20 characters. A brand whose name
 *   cannot be generated ABORTS the run and says which brand it was: it is never
 *   given an invented or empty name, and never silently skipped. Aborting is
 *   safe precisely because the run is idempotent.
 *
 * IDEMPOTENT — the candidate predicate is `offer_id IS NULL`. After a run there
 *   are none, so a re-run plans nothing, spends nothing on the LLM and writes
 *   nothing. A run that aborted half way is resumed by re-running it.
 * DRY-RUNNABLE — `--dry-run` reads and prints the plan, calls no LLM and writes
 *   nothing.
 * REVERSIBLE — every offer it creates carries `migrated_at`, so undoing it is an
 *   exact predicate with no timestamp window and it cannot touch an offer a
 *   person created:
 *     UPDATE brand_sales_funnels SET offer_id = NULL
 *      WHERE offer_id IN (SELECT id FROM brand_offers WHERE migrated_at IS NOT NULL);
 *     UPDATE brand_user_fields   SET offer_id = NULL
 *      WHERE offer_id IN (SELECT id FROM brand_offers WHERE migrated_at IS NOT NULL);
 *     DELETE FROM brand_offers WHERE migrated_at IS NOT NULL;
 *
 * Usage:
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-brand-offers.ts --dry-run
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/backfill-brand-offers.ts
 *
 * The counts this prints are the SCRIPT'S OWN LOG and are not the result. Read
 * the result back from the database:
 *   SELECT count(*) FROM brand_offers WHERE migrated_at IS NOT NULL;
 *   SELECT count(*) FROM brand_sales_funnels WHERE offer_id IS NULL;  -- 0 when done
 *   SELECT count(*) FROM brand_user_fields   WHERE offer_id IS NULL;  -- 0 when done
 * A re-run legitimately reports zero of everything, which is indistinguishable
 * from "it did nothing" in the log alone.
 */

import { planOfferMigration, type OfferMigrationPlan } from '../src/lib/offer-migration-plan';
import {
  createPlatformRun,
  updatePlatformRun,
} from '../src/lib/runs-client';
import {
  applyOfferMigration,
  countUnmigratedRows,
  readOfferMigrationCandidates,
} from '../src/services/offerMigrationService';

const SERVICE_NAME = 'brand-service';
const TASK_NAME = 'backfill-brand-offers';

function summarise(plan: OfferMigrationPlan): void {
  console.log(`\noffers to create: ${plan.offers.length}`);
  const funnelRows = plan.offers.reduce((n, o) => n + o.funnelRowCount, 0);
  const fieldRows = plan.offers.reduce((n, o) => n + o.userFieldRowCount, 0);
  console.log(`  funnel rows they will carry: ${funnelRows}`);
  console.log(`  confirmed field rows they will carry: ${fieldRows}`);

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

  const candidates = await readOfferMigrationCandidates();
  console.log(`(org, brand) pairs holding rows no offer owns yet: ${candidates.length}`);

  const plan = planOfferMigration(candidates);
  summarise(plan);

  if (dryRun) {
    console.log('\n--dry-run: no LLM call, nothing written.');
    return;
  }

  // Platform-level work: there is no customer org behind a migration, so it is
  // declared on a PLATFORM run. The LLM tokens are NOT posted here — they are
  // chat-service's, declared on its own platform run, and posting them again
  // would count the same spend twice.
  const run = await createPlatformRun({ serviceName: SERVICE_NAME, taskName: TASK_NAME });
  console.log(`\nplatform run ${run.id} opened`);

  try {
    const migrated = await applyOfferMigration(plan);
    for (const offer of migrated) {
      console.log(
        `  ${offer.brandId} -> "${offer.name}" (${offer.funnels} funnels, ${offer.userFields} fields)`
      );
    }
    await updatePlatformRun(run.id, 'completed', SERVICE_NAME);
  } catch (error) {
    // A failed run is a real outcome and is recorded as one. Everything already
    // migrated keeps its offer; re-running resumes from here.
    await updatePlatformRun(run.id, 'failed', SERVICE_NAME);
    throw error;
  }

  // Read the result back rather than reporting what we intended to write.
  const left = await countUnmigratedRows();
  console.log('\nread back from the database:');
  console.log(`  funnel rows still holding no offer: ${left.funnels}`);
  console.log(`  confirmed field rows still holding no offer: ${left.userFields}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
