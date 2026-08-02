import { and, eq, sql } from 'drizzle-orm';
import { db, orgBrands, brandSalesEconomics, brandClickDestinations } from '../db';
import type { RetiredGoal } from '../lib/goal-vocabulary';

// The retired goal vocabulary lives in `src/lib/goal-vocabulary.ts` — a pure
// module with no database import, so `src/schemas.ts` (and every unit test) can
// read the accepted spellings without pulling in a DB connection. Re-exported
// here because this service is where the rest of the codebase looks for what a
// goal a caller sent MEANT.
export * from '../lib/goal-vocabulary';

/**
 * `org_brands.current_goal` — the retired goal store.
 *
 * NOTHING derives an answer from it any more. What an org sells a brand through
 * is the set of sales funnels it declared (`brand_sales_funnels`), and that is
 * the only vocabulary any read emits. The column survives for two reasons and no
 * others: the legacy write acceptors still mirror into it, so a caller that
 * PUTs a goal and reads the column back is not lied to, and it is what the
 * one-time backfill inverted to give every brand the declaration its goal meant.
 *
 * The one read left is `GET /internal/brands/:brandId/runtime-context`, which
 * still serves `currentGoal` because campaign-service's scheduler boots on it
 * for every brand that has no per-funnel budget. That is the last goal-shaped
 * read in the service and it is tracked for removal; do not add another.
 */
export async function getCurrentGoalByBrandId(
  orgId: string,
  brandId: string
): Promise<RetiredGoal | null> {
  const [row] = await db
    .select({ currentGoal: orgBrands.currentGoal })
    .from(orgBrands)
    .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, brandId)))
    .limit(1);

  return (row?.currentGoal as RetiredGoal | undefined) ?? null;
}

/**
 * Mirror a goal a caller sent into the retired store. Returns null when the org
 * does not claim the brand — one org can never move another's configuration.
 *
 * This is a WRITE-COMPATIBILITY path. The declaration a caller's goal produces
 * is the funnel set; this only keeps the retired columns saying the same word
 * the caller sent, so nothing that reads them back disagrees with the request.
 */
export async function updateCurrentGoalByBrandId(
  orgId: string,
  brandId: string,
  currentGoal: RetiredGoal
): Promise<RetiredGoal | null> {
  const [updated] = await db
    .update(orgBrands)
    .set({ currentGoal, updatedAt: sql`NOW()` })
    .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, brandId)))
    .returning({ currentGoal: orgBrands.currentGoal });

  if (!updated) return null;

  await db
    .update(brandSalesEconomics)
    .set({
      optimizationGoal: currentGoal,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(brandSalesEconomics.orgId, orgId),
        eq(brandSalesEconomics.brandId, brandId)
      )
    );

  return updated.currentGoal as RetiredGoal;
}

/**
 * Whether this org has set a click destination for this brand.
 *
 * The one signal that tells the two meeting funnels apart for a goal that only
 * ever said `meetingBooked`: a brand landing outreach clicks on a page of its
 * own site books its meetings FROM THE WEBSITE. Read at the moment a goal is
 * resolved, never stored — the goal is retired and gains no new state here.
 */
export async function hasClickDestination(
  orgId: string,
  brandId: string
): Promise<boolean> {
  const [row] = await db
    .select({ brandId: brandClickDestinations.brandId })
    .from(brandClickDestinations)
    .where(
      and(
        eq(brandClickDestinations.orgId, orgId),
        eq(brandClickDestinations.brandId, brandId)
      )
    )
    .limit(1);

  return row !== undefined;
}
