/**
 * One-time repair (OFFER-REPLY-STEP-1024): re-judge, under today's judgment,
 * the offers whose steps brand-service ASSESSED without a given step. Before
 * the judgment knew we sell every offer by outreach, 50 assessed offers came
 * out without Positive reply, so features-service set aside every funnel
 * walking it and signup dead-ended at "No campaign can run right now".
 *
 * Only `assessed` rows are selected AND rewritten (the UPDATE is guarded on the
 * source): a client-stated row is never touched. Platform-billed Jev, one call
 * per offer. Re-running after --apply finds only the offers still judged
 * without the step.
 *
 *   pnpm exec tsx scripts/reassess-offer-steps.ts --missing-step conversation           # preview, writes nothing
 *   pnpm exec tsx scripts/reassess-offer-steps.ts --missing-step conversation --apply   # rewrite
 *
 * Run inside the brand-service container (DB + CHAT_SERVICE env).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, brandOfferSalesPaths } from '../src/db';
import { reassessAssessedOfferSteps } from '../src/services/offerStepsService';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const flag = process.argv.indexOf('--missing-step');
  const missingStep = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!missingStep) throw new Error('--missing-step <stepKey> is required');

  const rows = await db
    .select({ offerId: brandOfferSalesPaths.offerId })
    .from(brandOfferSalesPaths)
    .where(and(
      eq(brandOfferSalesPaths.stepsSource, 'assessed'),
      sql`NOT (${missingStep}::text = ANY(${brandOfferSalesPaths.steps}))`,
    ));
  console.log(`${rows.length} assessed offer(s) without "${missingStep}" (${apply ? 'APPLY' : 'preview'})`);

  let gained = 0;
  let written = 0;
  for (const { offerId } of rows) {
    const result = await reassessAssessedOfferSteps(offerId, { apply });
    if (!result) {
      console.log(`${offerId}\tskipped (no assessed row any more)`);
      continue;
    }
    if (result.after.includes(missingStep)) gained += 1;
    if (result.written) written += 1;
    const added = result.after.filter((s) => !result.before.includes(s));
    const removed = result.before.filter((s) => !result.after.includes(s));
    console.log(`${offerId}\t+[${added.join(',')}]\t-[${removed.join(',')}]\t${result.written ? 'written' : ''}`);
  }
  console.log(`done: ${gained}/${rows.length} now carry "${missingStep}", ${written} written`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
