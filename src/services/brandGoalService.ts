import { eq, sql } from 'drizzle-orm';
import { db, brands, brandSalesEconomics } from '../db';

/**
 * Canonical brand-owned runtime goal vocabulary. This mirrors the vocabulary
 * features-service runtime candidate selection accepts as its `goal` input.
 */
export type CurrentGoal =
  | 'signup'
  | 'meetingBooked'
  // `purchase` is the "website purchase" goal (a paying client won via the
  // website-visit→purchase path). Its DISPLAY name renamed to "website purchase";
  // the canonical token + runtime behavior are UNCHANGED so features-service /
  // campaign-service keep interpreting existing purchase-brands identically.
  | 'purchase'
  | 'websiteVisit'
  | 'positiveReply'
  | 'whatsappConversation'
  // `combinedSales` is the NEW combined "Sales" goal: maximize paying clients won
  // via EITHER the positive-reply path OR the website-visit path, valued at the
  // customer's lifetime revenue (CLTV). A genuinely NEW runtime behavior
  // (features-service selects candidates across BOTH paths), so it gets its own
  // dedicated CurrentGoal (Pattern A). It reuses the EXISTING replyToPaidClientPct
  // + visitToPaidClientPct rates — no new rate columns.
  | 'combinedSales';

/**
 * Legacy sales-economics wire vocabulary kept for backward compatibility.
 * `form_submissions` is a wire-only sub-type of the `signup` runtime goal: it
 * collapses to `signup` on write (runtime consumers never see a new value) and
 * is recovered from the stored optimization_goal column on the org (wire) read.
 */
export type LegacyOptimizationGoal =
  | 'signups'
  | 'booked_meetings'
  // `sales` is the LEGACY wire spelling of the "website purchase" goal. Kept for
  // backward-compat: the old dashboard still sends it during the transition
  // window, and it is what the internal (campaign-service) read emits — so it
  // ALWAYS means website-purchase, and can NEVER be re-purposed for the new
  // combined goal (that would silently reinterpret every stored purchase-brand).
  | 'sales'
  | 'website_visits'
  | 'positive_replies'
  | 'form_submissions'
  | 'whatsapp_conversations'
  // `website_purchase` is the NEW preferred wire spelling of the SAME
  // "website purchase" goal — a wire-only sub-type of `purchase` (like
  // `form_submissions` is of `signup`). It shares the `purchase` runtime goal, so
  // the internal read collapses it to `sales`; the org read recovers it from the
  // stored column (resolveWireOptimizationGoal).
  | 'website_purchase'
  // `combined_sales` is the wire value for the NEW combined "Sales" goal. A
  // brand-new token the old dashboard never sends, so it can never collide with
  // stored `sales`/`website_purchase` (website-purchase) rows. 1:1 with the
  // `combinedSales` current-goal.
  | 'combined_sales';

export const CURRENT_GOALS = [
  'signup',
  'meetingBooked',
  'purchase',
  'websiteVisit',
  'positiveReply',
  'whatsappConversation',
  'combinedSales',
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
    case 'website_purchase':
      // New preferred spelling of the website-purchase goal — same runtime goal
      // as legacy `sales`. Wire-only sub-type of `purchase`; runtime consumers
      // never see a new value.
      return 'purchase';
    case 'website_visits':
      return 'websiteVisit';
    case 'positive_replies':
      return 'positiveReply';
    case 'combined_sales':
      // NEW combined goal: paying clients via reply OR visit (CLTV). Dedicated
      // runtime goal — features-service selects across both paths.
      return 'combinedSales';
    case 'form_submissions':
      // Mid-funnel micro-conversion — same visit→micro-conversion→paid family as
      // signups, same outreach behavior. Collapses to the signup runtime goal so
      // features-service / campaign-service never see a new value.
      return 'signup';
    case 'whatsapp_conversations':
      // "Maximize WhatsApp conversations": recipients click a WhatsApp link to
      // start a conversation instead of replying by email. A genuinely NEW
      // outcome with its OWN cost-per-outcome math (built as a separate
      // features-service task), so it gets a dedicated runtime goal — NOT a
      // wire-only sub-type of an existing goal. 1:1 with the legacy value.
      return 'whatsappConversation';
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
    case 'whatsappConversation':
      return 'whatsapp_conversations';
    case 'combinedSales':
      return 'combined_sales';
  }
}

/**
 * Resolve the wire `optimizationGoal` for an ORG (dashboard) read. Identical to
 * `currentGoalToLegacyOptimizationGoal` EXCEPT it recovers a wire-only SUB-TYPE
 * from the stored legacy column when two wire values collapse to one runtime goal:
 *   - `form_submissions` under the `signup` runtime goal, and
 *   - `website_purchase` under the `purchase` runtime goal (new preferred spelling
 *     of website-purchase; the base wire value is `sales`).
 * The INTERNAL (campaign-service) read must NOT use this — it needs the runtime-safe
 * collapse (`signups` / `sales`) so it never sees a sub-type value.
 */
export function resolveWireOptimizationGoal(
  currentGoal: CurrentGoal,
  storedLegacy: string | null | undefined
): LegacyOptimizationGoal {
  if (currentGoal === 'signup' && storedLegacy === 'form_submissions') {
    return 'form_submissions';
  }
  if (currentGoal === 'purchase' && storedLegacy === 'website_purchase') {
    return 'website_purchase';
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
