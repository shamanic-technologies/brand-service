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
 * is an unattributed segment of a combination key. An offer's sales-path legs
 * carry their channel (`SalesPathLeg`), so they fold exactly like a segment.
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
 * The LEGACY outbound spellings found in what a caller sent, each with the
 * feature it was sent for. Used only to make every legacy arrival visible
 * (`legacy-outbound-leg-key`); it decides nothing.
 */
export function legacyOutboundLegKeysInCombinationKey(combinationKey: string): string[] {
  return combinationKey.split('+').filter((segment) => {
    const at = segment.indexOf('@');
    return at >= 0 && isLegacyOutboundLegKey(segment.slice(0, at), segment.slice(at + 1));
  });
}

/** True when `legKey` is the legacy spelling of an outbound leg on `featureSlug`. */
export function isLegacyOutboundLegKey(legKey: string, featureSlug: string | null): boolean {
  return featureSlug !== null && OUTBOUND_FEATURE_SLUGS.has(featureSlug) && legKey in LEGACY_TO_NEW;
}

// ---------------------------------------------------------------------------
// AN OFFER'S SALES-PATH LEGS CARRY THEIR CHANNEL (owner 2026-10-09).
// ---------------------------------------------------------------------------

/**
 * One leg an offer sells through, WITH the channel (features-service feature
 * slug) that performs it. `featureSlug: null` = no channel stated, which is
 * legal only for a leg that is not an ENTRY leg (`conversation_to_paid_client`
 * happens after the channel did its job). An entry leg is the first move of a
 * lead (`start_to_*`, `lead_found_to_*`) and two channels perform the "same"
 * entry leg as two different things (Google Ads' website visit is not cold
 * email's), so an entry leg with no channel is REFUSED, never guessed.
 */
export interface SalesPathLeg {
  legKey: string;
  featureSlug: string | null;
}

/** An entry leg: the first move of a lead, performed by a channel. */
export function isEntryLegKey(legKey: string): boolean {
  return legKey.startsWith('start_to_') || legKey.startsWith('lead_found_to_');
}

/** The channel a legacy-shape write (bare `legKeys`) means for its entry legs. See `legsFromLegacyLegKeys`. */
export const LEGACY_SHAPE_ENTRY_CHANNEL = 'sales-cold-email-outreach';

export class EntryLegWithoutChannelError extends Error {
  constructor(public readonly legKey: string) {
    super(
      `Leg "${legKey}" is an entry leg and names no channel. Send it as { legKey: "${legKey}", featureSlug: "<feature slug>" }.`
    );
    this.name = 'EntryLegWithoutChannelError';
  }
}

/**
 * The legs as stored and served: each entry leg carries a channel (else
 * `EntryLegWithoutChannelError`), an outbound one in the NEW spelling; the same
 * (leg, channel) twice, in either spelling, collapses onto its first entry.
 */
export function normalizeSalesPathLegs(legs: SalesPathLeg[]): SalesPathLeg[] {
  const seen = new Set<string>();
  const out: SalesPathLeg[] = [];
  for (const { legKey, featureSlug } of legs) {
    if (featureSlug === null && isEntryLegKey(legKey)) throw new EntryLegWithoutChannelError(legKey);
    const leg = { legKey: canonicalLegKey(legKey, featureSlug), featureSlug };
    const id = formatSalesPathLeg(leg);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(leg);
  }
  return out;
}

/**
 * The LEGACY request shape (bare `legKeys`, no channel), accepted while the
 * dashboard moves to `legs`. It comes from exactly one surface, whose only
 * entry-leg channel is cold email (dashboard `SALES_PATH_CHANNEL_SLUGS`), so
 * that is what its entry legs mean: the same reading migration `0092` applied
 * to the 28 stored rows. A caller that means another channel sends `legs`.
 */
export function legsFromLegacyLegKeys(legKeys: string[]): SalesPathLeg[] {
  return legKeys.map((legKey) => ({
    legKey,
    featureSlug: isEntryLegKey(legKey) ? LEGACY_SHAPE_ENTRY_CHANNEL : null,
  }));
}

/** Stored form of one leg: `<legKey>@<featureSlug>`, or the bare key when no channel. */
export function formatSalesPathLeg(leg: SalesPathLeg): string {
  return leg.featureSlug === null ? leg.legKey : `${leg.legKey}@${leg.featureSlug}`;
}

export function parseSalesPathLeg(stored: string): SalesPathLeg {
  const at = stored.indexOf('@');
  return at < 0 ? { legKey: stored, featureSlug: null } : { legKey: stored.slice(0, at), featureSlug: stored.slice(at + 1) };
}

/**
 * The bare leg keys every existing reader consumes (`legKeys`), first occurrence
 * wins: two channels performing one leg read as that leg once.
 */
export function bareLegKeys(legs: SalesPathLeg[]): string[] {
  return dedupeKeepingOrder(legs.map((l) => l.legKey));
}
