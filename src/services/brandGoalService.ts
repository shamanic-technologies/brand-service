import { and, eq, sql } from 'drizzle-orm';
import { db, orgBrands, brandSalesEconomics } from '../db';
import type { RetiredGoal } from '../lib/goal-vocabulary';

// The retired goal vocabulary lives in `src/lib/goal-vocabulary.ts` — a pure
// module with no database import, so `src/schemas.ts` (and every unit test) can
// read the accepted spellings without pulling in a DB connection. Re-exported
// here because this service is where the rest of the codebase looks for what a
// goal a caller sent MEANT.
export * from '../lib/goal-vocabulary';

/**
 * `org_brands.current_goal` — the retired goal store. The one read left is
 * `GET /internal/brands/:brandId/runtime-context`, which campaign-service's
 * scheduler still boots on. Do not add another.
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
