import { and, eq } from 'drizzle-orm';
import { db, orgBrands } from '../db';
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
