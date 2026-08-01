import { and, eq, sql } from 'drizzle-orm';
import { db, orgBrands, brandSalesEconomics } from '../db';
import type { CurrentGoal } from '../lib/goal-vocabulary';

// The vocabulary itself lives in `src/lib/goal-vocabulary.ts` — a pure module
// with no database import, so `src/schemas.ts` (and every unit test) can read the
// canonical list without pulling in a DB connection. Re-exported here because
// this service is where the rest of the codebase looks for a brand's goal.
export * from '../lib/goal-vocabulary';

/**
 * What THIS org optimizes for on THIS brand.
 *
 * The goal lives on the (org, brand) membership, not on the shared `brands`
 * identity row: several orgs legitimately claim the same domain, so a goal
 * stored on the brand let any of them overwrite what the others optimize for.
 * `null` means this org does not claim this brand — never a default goal.
 */
export async function getCurrentGoalByBrandId(
  orgId: string,
  brandId: string
): Promise<CurrentGoal | null> {
  const [row] = await db
    .select({ currentGoal: orgBrands.currentGoal })
    .from(orgBrands)
    .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, brandId)))
    .limit(1);

  return (row?.currentGoal as CurrentGoal | undefined) ?? null;
}

/**
 * Set what this org optimizes for on this brand. Returns null when the org does
 * not claim the brand — one org can never move another's goal.
 *
 * The economics row's `optimization_goal` is mirrored so the column and the wire
 * keep saying the same word.
 */
export async function updateCurrentGoalByBrandId(
  orgId: string,
  brandId: string,
  currentGoal: CurrentGoal
): Promise<CurrentGoal | null> {
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

  return updated.currentGoal as CurrentGoal;
}
