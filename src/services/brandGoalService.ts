import { eq, sql } from 'drizzle-orm';
import { db, brands, brandSalesEconomics } from '../db';

/**
 * Canonical brand-owned runtime goal vocabulary. This mirrors the vocabulary
 * features-service runtime candidate selection accepts as its `goal` input.
 */
export type CurrentGoal = 'signup' | 'meetingBooked' | 'purchase';

/** Legacy sales-economics wire vocabulary kept for backward compatibility. */
export type LegacyOptimizationGoal = 'signups' | 'booked_meetings' | 'sales';

export const CURRENT_GOALS = ['signup', 'meetingBooked', 'purchase'] as const;

export function legacyOptimizationGoalToCurrentGoal(
  goal: LegacyOptimizationGoal
): CurrentGoal {
  switch (goal) {
    case 'signups':
      return 'signup';
    case 'booked_meetings':
      return 'meetingBooked';
    case 'sales':
      return 'purchase';
  }
}

export function currentGoalToLegacyOptimizationGoal(
  goal: CurrentGoal
): LegacyOptimizationGoal {
  switch (goal) {
    case 'signup':
      return 'signups';
    case 'meetingBooked':
      return 'booked_meetings';
    case 'purchase':
      return 'sales';
  }
}

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
 * Update the canonical current goal. If an old sales-economics row exists,
 * update its legacy alias too so older consumers keep seeing coherent data.
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
      optimizationGoal: currentGoalToLegacyOptimizationGoal(currentGoal),
      updatedAt: sql`NOW()`,
    })
    .where(eq(brandSalesEconomics.brandId, brandId));

  return updated.currentGoal as CurrentGoal;
}
