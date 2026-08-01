import { eq, sql } from 'drizzle-orm';
import { db, brands, brandSalesEconomics } from '../db';
import type { CurrentGoal } from '../lib/goal-vocabulary';

// The vocabulary itself lives in `src/lib/goal-vocabulary.ts` — a pure module
// with no database import, so `src/schemas.ts` (and every unit test) can read the
// canonical list without pulling in a DB connection. Re-exported here because
// this service is where the rest of the codebase looks for a brand's goal.
export * from '../lib/goal-vocabulary';

export async function getCurrentGoalByBrandId(
  brandId: string
): Promise<CurrentGoal | null> {
  const [row] = await db
    .select({ currentGoal: brands.currentGoal })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  return (row?.currentGoal as CurrentGoal | undefined) ?? null;
}

/**
 * Update the canonical current goal, and mirror it onto the sales-economics row
 * when one exists so the column and the wire keep saying the same word.
 */
export async function updateCurrentGoalByBrandId(
  brandId: string,
  currentGoal: CurrentGoal
): Promise<CurrentGoal | null> {
  const [updated] = await db
    .update(brands)
    .set({ currentGoal, updatedAt: sql`NOW()` })
    .where(eq(brands.id, brandId))
    .returning({ currentGoal: brands.currentGoal });

  if (!updated) return null;

  await db
    .update(brandSalesEconomics)
    .set({
      optimizationGoal: currentGoal,
      updatedAt: sql`NOW()`,
    })
    .where(eq(brandSalesEconomics.brandId, brandId));

  return updated.currentGoal as CurrentGoal;
}
