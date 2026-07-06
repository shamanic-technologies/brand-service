import { eq, sql } from 'drizzle-orm';
import { db, brands, brandSalesEconomics } from '../db';

/**
 * Canonical brand-owned runtime goal vocabulary. This mirrors the vocabulary
 * features-service runtime candidate selection accepts as its `goal` input.
 */
export type CurrentGoal =
  | 'signup'
  | 'meetingBooked'
  | 'purchase'
  | 'websiteVisit'
  | 'positiveReply';

/**
 * Legacy sales-economics wire vocabulary kept for backward compatibility.
 * `form_submissions` is a wire-only sub-type of the `signup` runtime goal: it
 * collapses to `signup` on write (runtime consumers never see a new value) and
 * is recovered from the stored optimization_goal column on the org (wire) read.
 */
export type LegacyOptimizationGoal =
  | 'signups'
  | 'booked_meetings'
  | 'sales'
  | 'website_visits'
  | 'positive_replies'
  | 'form_submissions';

export const CURRENT_GOALS = [
  'signup',
  'meetingBooked',
  'purchase',
  'websiteVisit',
  'positiveReply',
] as const;

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
    case 'website_visits':
      return 'websiteVisit';
    case 'positive_replies':
      return 'positiveReply';
    case 'form_submissions':
      // Mid-funnel micro-conversion — same visit→micro-conversion→paid family as
      // signups, same outreach behavior. Collapses to the signup runtime goal so
      // features-service / campaign-service never see a new value.
      return 'signup';
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
    case 'websiteVisit':
      return 'website_visits';
    case 'positiveReply':
      return 'positive_replies';
  }
}

/**
 * Resolve the wire `optimizationGoal` for an ORG (dashboard) read. Identical to
 * `currentGoalToLegacyOptimizationGoal` EXCEPT it recovers the `form_submissions`
 * sub-type from the stored legacy column when the runtime goal collapsed it to
 * `signup`. The INTERNAL (campaign-service) read must NOT use this — it needs the
 * runtime-safe collapse to `signups` so it never sees a new value.
 */
export function resolveWireOptimizationGoal(
  currentGoal: CurrentGoal,
  storedLegacy: string | null | undefined
): LegacyOptimizationGoal {
  if (currentGoal === 'signup' && storedLegacy === 'form_submissions') {
    return 'form_submissions';
  }
  return currentGoalToLegacyOptimizationGoal(currentGoal);
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
