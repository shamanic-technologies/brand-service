/**
 * THE RETIRED GOAL VOCABULARY. This module exists to keep OLD WRITES WORKING,
 * and for nothing else. Nothing here is ever emitted on a read.
 *
 * `ACCEPTED_OPTIMIZATION_GOALS` is every goal spelling the fleet has ever sent,
 * ACCEPTED ON WRITE FOREVER, so a caller sending yesterday's word keeps working.
 * A goal only mirrors into the retired columns (`org_brands.current_goal`,
 * `brand_sales_economics.optimization_goal`); it declares nothing. The one read
 * left is `GET /internal/brands/:brandId/runtime-context` (campaign-service).
 *
 * There is no goal on any other response and no third store of the concept. If
 * you are adding one, you are re-creating what this file retires.
 */

/**
 * The eight goal tokens the fleet used before the retirement. INPUT ONLY — they
 * are accepted on write and mirrored; none is ever emitted.
 *
 * They stay listed because a caller still sends them.
 */
export const RETIRED_GOALS = [
  'signup',
  'meetingBooked',
  'websitePurchase',
  'combinedSales',
  'websiteVisit',
  'positiveReply',
  'formSubmission',
  'whatsappConversation',
] as const;

export type RetiredGoal = (typeof RETIRED_GOALS)[number];

export function isRetiredGoal(value: string): value is RetiredGoal {
  return (RETIRED_GOALS as readonly string[]).includes(value);
}

/**
 * Every OTHER spelling a caller may still send. Accepted forever, same as above.
 *
 * `purchase` is here because it was canonical until the `websitePurchase`
 * rename; `sales` has meant WEBSITE PURCHASE in every stored row since the goal
 * existed and can never be re-pointed at the combined goal.
 */
export const LEGACY_OPTIMIZATION_GOALS = [
  'signups',
  'booked_meetings',
  // The dashboard's own local spelling of the booked-meeting goal.
  'sales_meetings',
  // The legacy wire spelling of WEBSITE PURCHASE — never the combined goal.
  'sales',
  'website_purchase',
  'combined_sales',
  'website_visits',
  'positive_replies',
  'form_submissions',
  'whatsapp_conversations',
  // The pre-rename canonical spelling of `websitePurchase`.
  'purchase',
] as const;

export type LegacyOptimizationGoal = (typeof LEGACY_OPTIMIZATION_GOALS)[number];

/** Every goal spelling accepted on write. */
export type AcceptedOptimizationGoal = RetiredGoal | LegacyOptimizationGoal;

export const ACCEPTED_OPTIMIZATION_GOALS = [
  ...RETIRED_GOALS,
  ...LEGACY_OPTIMIZATION_GOALS,
] as const;

/**
 * Resolve any accepted spelling to the retired token it names.
 *
 * Exhaustive by construction — the switch has one case per accepted value and
 * `tsc` fails when a value is added to either list without a case here. There is
 * no default branch and no default goal: a spelling we cannot name must never
 * quietly become a different goal.
 */
export function toRetiredGoal(goal: AcceptedOptimizationGoal): RetiredGoal {
  switch (goal) {
    case 'signup':
    case 'signups':
      return 'signup';
    case 'meetingBooked':
    case 'booked_meetings':
    case 'sales_meetings':
      return 'meetingBooked';
    case 'websitePurchase':
    case 'sales':
    case 'website_purchase':
    case 'purchase':
      return 'websitePurchase';
    case 'combinedSales':
    case 'combined_sales':
      return 'combinedSales';
    case 'websiteVisit':
    case 'website_visits':
      return 'websiteVisit';
    case 'positiveReply':
    case 'positive_replies':
      return 'positiveReply';
    case 'formSubmission':
    case 'form_submissions':
      return 'formSubmission';
    case 'whatsappConversation':
    case 'whatsapp_conversations':
      return 'whatsappConversation';
  }
}
