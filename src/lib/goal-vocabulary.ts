/**
 * THE RETIRED GOAL VOCABULARY. The goal is emitted on one read only:
 * `GET /internal/brands/:brandId/runtime-context` (campaign-service), which
 * serves `org_brands.current_goal`. Nothing writes that column any more (its
 * one writer was the brand sales-economics PUT, retired 2026-10-05).
 *
 * There is no goal on any other response and no other store of the concept. If
 * you are adding one, you are re-creating what this file retires.
 */

/**
 * The eight goal tokens a stored `org_brands.current_goal` may hold.
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
