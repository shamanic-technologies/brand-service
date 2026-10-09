/**
 * ONE IDENTITY, TWO SPELLINGS — the outbound leg-key rename (owner-locked
 * 2026-10-09). On an OUTBOUND feature, and only there:
 *
 *     start_to_conversation   ==  lead_found_to_conversation
 *     start_to_website_visit  ==  lead_found_to_website_visit
 *
 * Wave 1 made the two spellings one identity wherever this service compares
 * leg keys (the "a combinationKey twice" refusal). WAVE 2 (2026-10-09) stores
 * and serves the NEW spelling: migration `0091` rewrote every stored row, every
 * write folds a legacy input to the new spelling before storing it, and every
 * read folds again on the way out (a row written by the previous container
 * during the deploy swap still serves new). The legacy spelling stays ACCEPTED
 * on input; dropping that tolerance is a later, separate decision.
 *
 * Legacy keys on a non-outbound feature (ads, SEO, PR...) are untouched, and so
 * is an unattributed segment of a combination key. The one place a BARE key is
 * folded is an offer's sales path (`toNewSalesPathLegKeys`), see there.
 *
 * No database import, so it carries real unit tests (`tests/unit/outboundLegKeys.test.ts`).
 */

/** The features whose channelType is OUTBOUND (LOCKED list). */
export const OUTBOUND_FEATURE_SLUGS: ReadonlySet<string> = new Set([
  'sales-cold-email-outreach',
  'feedback-request-cold-email-outreach',
  'sales-crm-email-outreach',
  'cold-call-outreach',
  'cold-instagram-outreach',
  'cold-linkedin-outreach',
  'cold-reddit-outreach',
  'cold-sms-outreach',
  'cold-whatsapp-outreach',
  'cold-x-outreach',
]);

/** Legacy spelling -> new spelling, valid only on an outbound feature. */
const LEGACY_TO_NEW: Readonly<Record<string, string>> = {
  start_to_conversation: 'lead_found_to_conversation',
  start_to_website_visit: 'lead_found_to_website_visit',
};

/** The comparison form of one leg key served by `featureSlug` (null = no feature). */
export function canonicalLegKey(legKey: string, featureSlug: string | null): string {
  if (featureSlug === null || !OUTBOUND_FEATURE_SLUGS.has(featureSlug)) return legKey;
  return LEGACY_TO_NEW[legKey] ?? legKey;
}

/**
 * The comparison form of a features-service combinationKey: `+`-joined
 * segments, each `<legKey>` or `<legKey>@<featureSlug>`. Only an outbound
 * segment's leg is folded; every other byte is kept, so two keys compare equal
 * exactly when they differ by nothing but the outbound spelling.
 */
export function canonicalCombinationKey(combinationKey: string): string {
  return combinationKey
    .split('+')
    .map((segment) => {
      const at = segment.indexOf('@');
      if (at < 0) return segment;
      const feature = segment.slice(at + 1);
      return `${canonicalLegKey(segment.slice(0, at), feature)}@${feature}`;
    })
    .join('+');
}

/** True when two entries of the list name the same path (either spelling). */
export function hasDuplicateCombinationKey(combinationKeys: string[]): boolean {
  return new Set(combinationKeys.map(canonicalCombinationKey)).size !== combinationKeys.length;
}

/**
 * A features-service combinationKey with every OUTBOUND segment in the new
 * spelling (the canonical form IS the new spelling). What wave 2 stores and serves.
 */
export const toNewCombinationKey = canonicalCombinationKey;

/** First occurrence wins: two spellings of one key collapse onto one entry, order kept. */
function dedupeKeepingOrder(keys: string[]): string[] {
  return [...new Set(keys)];
}

/** An offer's selected combinationKeys as stored and served from wave 2 on. */
export function toNewCombinationKeys(combinationKeys: string[]): string[] {
  return dedupeKeepingOrder(combinationKeys.map(toNewCombinationKey));
}

/**
 * An offer's sales-path leg keys as stored and served from wave 2 on. These are
 * BARE keys (no feature), and they ARE folded, because of how they are made:
 * the Sales path surface offers an ENTRY leg only when one of the channels we
 * run performs it (dashboard `offeredLegs` over `SALES_PATH_CHANNEL_SLUGS`), and
 * the only one of those that performs an entry leg is cold email, an OUTBOUND
 * feature. So every `start_to_conversation` / `start_to_website_visit` this
 * table holds was ticked as cold email's leg (checked in prod 2026-10-09: 28
 * rows, every entry leg among the two legacy keys). If a non-outbound channel
 * ever joins that surface, its entry legs must be stored with their feature.
 */
export function toNewSalesPathLegKeys(legKeys: string[]): string[] {
  return dedupeKeepingOrder(legKeys.map((k) => LEGACY_TO_NEW[k] ?? k));
}
