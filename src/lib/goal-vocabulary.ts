/**
 * THE canonical goal vocabulary. brand-service owns it, emits it on every read,
 * and emits nothing else.
 *
 * This list is a FLEET decision, not a brand-service preference: the same eight
 * tokens are pinned in features-service (`src/lib/goals.ts`) and in the dashboard
 * (`apps/dashboard/src/lib/api.ts` `CANONICAL_GOALS`). Changing it means changing
 * what three services call the same goal, so it must never move in a single-repo
 * PR — `tests/unit/goalVocabulary.test.ts` fails if it does.
 *
 * Two of the tokens were chosen against the obvious spelling, on purpose:
 *   - `websitePurchase`, not `purchase`, because `purchase` is the ambiguous one
 *     and the display name already renamed to "website purchase".
 *   - `combinedSales`, not a bare `sales`, because `sales` is the LEGACY wire
 *     spelling of WEBSITE PURCHASE here and in every stored row. Reusing it for
 *     the combined goal is what put every website-purchase brand into the
 *     combined-sales bucket of the cross-org fleet benchmark (distribute.you#3214).
 *
 * `formSubmission` is first class rather than a wire-only sub-type of `signup`.
 * features-service ranks form submission as its own goal with its own funnel
 * (visit→form→paid), so collapsing it here threw the distinction away at the
 * boundary and forced the consumer to re-derive it.
 */
export const CANONICAL_GOALS = [
  'signup',
  'meetingBooked',
  'websitePurchase',
  'combinedSales',
  'websiteVisit',
  'positiveReply',
  'formSubmission',
  'whatsappConversation',
] as const;

export type CurrentGoal = (typeof CANONICAL_GOALS)[number];

export function isCurrentGoal(value: string): value is CurrentGoal {
  return (CANONICAL_GOALS as readonly string[]).includes(value);
}

/**
 * Every spelling a caller may still send on WRITE, besides the canonical eight.
 *
 * These are ACCEPTED FOREVER. A caller sending yesterday's word keeps working —
 * no consumer has to change in lockstep with the emission switch, which is the
 * whole reason the switch is safe to make. They are NEVER emitted: every read
 * answers with the canonical token the value maps to.
 *
 * `purchase` is here because it WAS canonical until the rename; a caller still
 * PUTting it must land on `websitePurchase` rather than 400.
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

/** Every goal spelling accepted on write: the canonical eight + every legacy one. */
export type AcceptedOptimizationGoal = CurrentGoal | LegacyOptimizationGoal;

export const ACCEPTED_OPTIMIZATION_GOALS = [
  ...CANONICAL_GOALS,
  ...LEGACY_OPTIMIZATION_GOALS,
] as const;

/**
 * Resolve any accepted spelling to its canonical token.
 *
 * Exhaustive by construction — the switch has one case per accepted value and
 * `tsc` fails when a value is added to either list without a case here. There is
 * no default branch and no default goal: a spelling we cannot name must never
 * quietly become a different goal.
 */
export function toCurrentGoal(goal: AcceptedOptimizationGoal): CurrentGoal {
  switch (goal) {
    case 'signup':
    case 'signups':
      return 'signup';
    case 'meetingBooked':
    case 'booked_meetings':
    // Two spellings of one goal — the dashboard's local `sales_meetings` and
    // brand-service's own `booked_meetings`. Accepting both at the source is
    // what stops the drift being patched up in a downstream tolerance layer.
    case 'sales_meetings':
      return 'meetingBooked';
    case 'websitePurchase':
    // `sales` has meant website purchase in every stored row since the goal
    // existed, and the old dashboard still sends it. It can NEVER be re-pointed
    // at the combined goal — that would silently reinterpret every stored row.
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
