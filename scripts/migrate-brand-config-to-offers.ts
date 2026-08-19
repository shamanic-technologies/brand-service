/**
 * ONE-TIME MIGRATION — move what a brand states it sells onto an OFFER.
 *
 * Before offers, the Hormozi value-proposition fields (`brand_user_fields`) and
 * the declared sales funnels with their economics (`brand_sales_funnels`) hung
 * off the brand, so a brand selling a $200 self-serve plan AND a $20k enterprise
 * contract had to describe both as one thing with one set of rates and one
 * lifetime revenue. This gives every (org, brand) pair that stated either
 * exactly ONE offer carrying all of it.
 *
 * BYTE-FAITHFUL — only `offer_id` is written. Not a rate, not a revenue, not a
 *   confirmed value is rewritten, defaulted or dropped.
 * NAMED FROM WHAT IT SELLS — the name is an LLM call through chat-service (never
 *   a provider SDK), reading the pair's value proposition and declared funnels.
 *   At most 2 words, at most 20 characters, unique within the brand.
 * PLATFORM RUN — this is platform work with no customer org behind it, so the run
 *   is declared on runs-service `/v1/platform-runs`. The token spend itself is
 *   declared by chat-service, which is the terminal caller of the model; posting
 *   a cost row here as well would double-count it.
 * FAILS LOUD — a pair whose name cannot be resolved is REPORTED and left exactly
 *   as it was found. It never receives an invented name and never receives an
 *   empty offer. The run is marked `failed` when any pair failed.
 * IDEMPOTENT — a candidate is a pair still holding a row with `offer_id IS NULL`,
 *   so a second run finds none and changes nothing.
 * REVERSIBLE — every offer this creates carries `migrated_from_brand_at`:
 *     UPDATE brand_user_fields   SET offer_id = NULL WHERE offer_id IN
 *       (SELECT id FROM brand_offers WHERE migrated_from_brand_at IS NOT NULL);
 *     UPDATE brand_sales_funnels SET offer_id = NULL WHERE offer_id IN
 *       (SELECT id FROM brand_offers WHERE migrated_from_brand_at IS NOT NULL);
 *     DELETE FROM brand_offers WHERE migrated_from_brand_at IS NOT NULL;
 * DRY-RUNNABLE — `--dry-run` prints the plan (including the names the model
 *   proposes) and writes nothing.
 *
 * Usage:
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/migrate-brand-config-to-offers.ts --dry-run
 *   BRAND_SERVICE_DATABASE_URL=... npx tsx scripts/migrate-brand-config-to-offers.ts
 *
 * The counts printed are the SCRIPT'S OWN LOG and are not the result. Read the
 * result back from the database:
 *   SELECT count(*) FROM brand_offers WHERE migrated_from_brand_at IS NOT NULL;
 *   SELECT count(*) FROM brand_user_fields   WHERE offer_id IS NULL;  -- expect 0
 *   SELECT count(*) FROM brand_sales_funnels WHERE offer_id IS NULL;  -- expect 0
 */

import { createOffer } from '../src/services/brandOfferService';
import { nameOffer } from '../src/services/offerNamingService';
import {
  attachPairToOffer,
  readMigrationCandidates,
  readMigrationState,
  type OfferMigrationCandidate,
} from '../src/services/offerMigrationService';
import { createPlatformRun, updatePlatformRun } from '../src/lib/runs-client';

const SERVICE_NAME = 'brand-service';
const TASK_NAME = 'migrate-brand-config-to-offers';

function describe(candidate: OfferMigrationCandidate): string {
  const what = candidate.existingOfferId ? `attach → offer ${candidate.existingOfferId}` : 'create offer';
  return (
    `${candidate.orgId} / ${candidate.brandId}: ${what} ` +
    `(${candidate.fieldRowCount} confirmed fields, ${candidate.funnelRowCount} funnels)`
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const candidates = await readMigrationCandidates();
  console.log(`${dryRun ? '[dry-run] ' : ''}pairs still holding pre-offer config: ${candidates.length}`);
  if (candidates.length === 0) {
    const state = await readMigrationState();
    console.log(`nothing to do. state: ${JSON.stringify(state)}`);
    return;
  }

  // The run covers the naming spend as well as the move, so it is opened before
  // the first model call — including on a dry run, which still calls the model.
  const run = await createPlatformRun({
    serviceName: SERVICE_NAME,
    taskName: TASK_NAME,
    idempotencyKey: `brand-service:${TASK_NAME}:${dryRun ? 'dry-run' : 'apply'}:${new Date().toISOString().slice(0, 10)}`,
  });
  console.log(`platform run ${run.id}`);

  const failures: { orgId: string; brandId: string; reason: string }[] = [];
  let created = 0;
  let attached = 0;
  let movedFields = 0;
  let movedFunnels = 0;

  for (const candidate of candidates) {
    console.log(describe(candidate));
    try {
      let offerId = candidate.existingOfferId;

      if (!offerId) {
        const name = await nameOffer({
          brandId: candidate.brandId,
          valueProposition: candidate.valueProposition,
          funnelNames: candidate.funnelNames,
          taken: candidate.takenNames,
        });
        console.log(`  name: "${name}"`);
        if (dryRun) continue;

        const offer = await createOffer(candidate.orgId, candidate.brandId, name, {
          migratedFromBrandAt: new Date().toISOString(),
        });
        offerId = offer.id;
        created += 1;
      } else if (dryRun) {
        continue;
      } else {
        attached += 1;
      }

      const moved = await attachPairToOffer(candidate.orgId, candidate.brandId, offerId);
      movedFields += moved.fields;
      movedFunnels += moved.funnels;
      console.log(`  moved ${moved.fields} fields, ${moved.funnels} funnels onto ${offerId}`);
    } catch (error) {
      const reason = (error as Error).message;
      console.error(`  FAILED: ${reason}`);
      failures.push({ orgId: candidate.orgId, brandId: candidate.brandId, reason });
    }
  }

  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}offers created: ${created}, existing offers reused: ${attached}, ` +
    `fields moved: ${movedFields}, funnels moved: ${movedFunnels}, failed pairs: ${failures.length}`
  );
  for (const failure of failures) {
    console.log(`  ${failure.orgId} / ${failure.brandId}: ${failure.reason}`);
  }

  await updatePlatformRun(run.id, failures.length > 0 ? 'failed' : 'completed', SERVICE_NAME);

  if (!dryRun) {
    console.log(`\nstate read back independently: ${JSON.stringify(await readMigrationState())}`);
  }

  if (failures.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
