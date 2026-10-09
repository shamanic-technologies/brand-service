/**
 * ONE IDENTITY, TWO SPELLINGS — the outbound leg-key rename (owner-locked
 * 2026-10-09). On an OUTBOUND feature, and only there:
 *
 *     start_to_conversation   ==  lead_found_to_conversation
 *     start_to_website_visit  ==  lead_found_to_website_visit
 *
 * Wave 1: wherever this service COMPARES leg keys (today: the "a combinationKey
 * twice" refusal on an offer's selected sales paths) the two spellings are the
 * same key. Nothing is rewritten: what a caller sends is stored and served AS
 * GIVEN. The canonical form is a comparison key only, never persisted.
 *
 * A leg key with no feature (a bare `start_to_website_visit` in an offer's
 * sales path, or an unattributed combination segment) names no channel, so it
 * cannot be told outbound from paid/earned and is never folded. Same for the
 * legacy keys on a non-outbound feature (ads, SEO, PR...): untouched.
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
