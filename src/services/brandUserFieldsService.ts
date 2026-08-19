import { eq, and, isNull, or, gt, desc, inArray, sql, type SQL } from 'drizzle-orm';
import { db, brandUserFields, brandExtractedFields } from '../db';
import { resolveLegacyOfferId, resolveOrCreateLegacyOfferId } from './brandOfferService';

/**
 * The 7 user-facing "confirmed" field keys. A value the user validates in the
 * dashboard is stored durably (no TTL) in `brand_user_fields`. `dreamOutcome`
 * REPLACES the old `valueProposition` in the user-facing set — `valueProposition`
 * is NOT user-facing anymore (it stays a pure backend-extract field).
 */
export const USER_FACING_FIELD_KEYS = [
  'services',
  'dreamOutcome',
  'perceivedLikelihood',
  'socialProof',
  'riskReversal',
  'urgency',
  'scarcity',
] as const;

export type UserFacingFieldKey = (typeof USER_FACING_FIELD_KEYS)[number];

const USER_FACING_KEY_SET: ReadonlySet<string> = new Set(USER_FACING_FIELD_KEYS);

export function isUserFacingFieldKey(key: string): key is UserFacingFieldKey {
  return USER_FACING_KEY_SET.has(key);
}

/** Thrown when an upsert carries a key outside the 7 user-facing keys → 400 upstream. */
export class UnknownUserFieldKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown user field key: "${key}". Allowed keys: ${USER_FACING_FIELD_KEYS.join(', ')}`);
    this.name = 'UnknownUserFieldKeyError';
  }
}

export interface ConfirmedUserField {
  value: unknown;
  confirmedAt: string;
}

/**
 * The value proposition is what an OFFER promises, so a confirmed value belongs
 * to an offer. `offerId === null` scopes to the rows stated before offers existed
 * — which is exactly what a brand-scoped read must answer with until the one-time
 * migration has moved them.
 */
function offerScope(offerId: string | null): SQL {
  return offerId === null
    ? isNull(brandUserFields.offerId)
    : eq(brandUserFields.offerId, offerId);
}

/**
 * Read the confirmed (user-validated) fields for one OFFER as a Map keyed by
 * field key. Only the 7 user-facing keys can ever be present (DB CHECK).
 */
export async function getConfirmedByOfferId(
  orgId: string,
  brandId: string,
  offerId: string | null,
): Promise<Map<string, ConfirmedUserField>> {
  const rows = await db
    .select({
      fieldKey: brandUserFields.fieldKey,
      value: brandUserFields.value,
      confirmedAt: brandUserFields.confirmedAt,
    })
    .from(brandUserFields)
    .where(
      and(
        eq(brandUserFields.orgId, orgId),
        eq(brandUserFields.brandId, brandId),
        offerScope(offerId),
      ),
    );

  const map = new Map<string, ConfirmedUserField>();
  for (const row of rows) {
    map.set(row.fieldKey, { value: row.value, confirmedAt: row.confirmedAt });
  }
  return map;
}

/**
 * TRANSITIONAL brand-scoped read: the confirmed fields of the brand's EARLIEST
 * offer, or — before the one-time migration has run for this pair — the rows
 * that still carry no offer at all. Both branches return exactly what this read
 * returned before offers existed, which is the whole point: a consumer that has
 * not migrated sees no change.
 */
export async function getConfirmedByBrandId(
  orgId: string,
  brandId: string,
): Promise<Map<string, ConfirmedUserField>> {
  const offerId = await resolveLegacyOfferId(orgId, brandId);
  return getConfirmedByOfferId(orgId, brandId, offerId);
}

export type FieldProvenance = 'confirmed' | 'suggested';

export interface UserFieldView {
  value: unknown;
  provenance: FieldProvenance;
}

/**
 * Pure merge: for each of the 7 user-facing keys, a confirmed value wins
 * (provenance `confirmed`); otherwise the most-recent non-expired auto-extract
 * prefill is returned (provenance `suggested`, value defaults to null). Unit-tested.
 */
export function buildUserFieldsView(
  confirmed: Map<string, ConfirmedUserField>,
  suggestedByKey: Map<string, unknown>,
): Record<string, UserFieldView> {
  const out: Record<string, UserFieldView> = {};
  for (const key of USER_FACING_FIELD_KEYS) {
    const c = confirmed.get(key);
    if (c) {
      out[key] = { value: c.value, provenance: 'confirmed' };
    } else {
      out[key] = { value: suggestedByKey.get(key) ?? null, provenance: 'suggested' };
    }
  }
  return out;
}

/**
 * For each of the 7 user-facing keys, the most-recent NON-EXPIRED extracted-cache
 * value for (brand_id, field_key, campaign_id IS NULL). The `field_description`
 * hash is ignored (any description matches). A row with a NULL `expires_at` never
 * expires. Returns a Map<key, value> — keys with no usable row are absent.
 */
export async function getSuggestedByBrandId(orgId: string, brandId: string): Promise<Map<string, unknown>> {
  const rows = await db
    .select({
      fieldKey: brandExtractedFields.fieldKey,
      fieldValue: brandExtractedFields.fieldValue,
      extractedAt: brandExtractedFields.extractedAt,
    })
    .from(brandExtractedFields)
    .where(
      and(
        eq(brandExtractedFields.brandId, brandId),
        isNull(brandExtractedFields.campaignId),
        inArray(brandExtractedFields.fieldKey, [...USER_FACING_FIELD_KEYS]),
        or(isNull(brandExtractedFields.expiresAt), gt(brandExtractedFields.expiresAt, sql`NOW()`)),
      ),
    )
    .orderBy(desc(brandExtractedFields.extractedAt));

  // Rows are newest-first; keep the FIRST seen value per key.
  const map = new Map<string, unknown>();
  for (const row of rows) {
    if (!map.has(row.fieldKey)) map.set(row.fieldKey, row.fieldValue);
  }
  return map;
}

/**
 * The full user-fields view for one OFFER: all 7 keys, each tagged `confirmed`
 * (user-validated value) or `suggested` (auto-extract prefill or null). Does NOT
 * trigger extraction.
 *
 * The CONFIRMED layer is offer-scoped; the SUGGESTED layer stays BRAND-scoped and
 * that is deliberate. A suggestion is what the extractor read off the brand's own
 * site — an ephemeral prefill, not something a user stated — and the site says
 * one thing whichever offer is being described. Two offers therefore start from
 * the same prefill and diverge the moment either is confirmed, which is the same
 * value this read produced before offers existed.
 */
export async function getUserFieldsViewForOffer(
  orgId: string,
  brandId: string,
  offerId: string | null,
): Promise<Record<string, UserFieldView>> {
  const [confirmed, suggested] = await Promise.all([
    getConfirmedByOfferId(orgId, brandId, offerId),
    getSuggestedByBrandId(orgId, brandId),
  ]);
  return buildUserFieldsView(confirmed, suggested);
}

/**
 * TRANSITIONAL brand-scoped view — the brand's earliest offer, or the pre-offer
 * rows when it has none. Byte-identical to what this returned before offers.
 */
export async function getUserFieldsView(orgId: string, brandId: string): Promise<Record<string, UserFieldView>> {
  const offerId = await resolveLegacyOfferId(orgId, brandId);
  return getUserFieldsViewForOffer(orgId, brandId, offerId);
}

/**
 * Upsert one or more confirmed user fields on one OFFER. Every supplied key MUST
 * be one of the 7 user-facing keys — an unknown key throws
 * `UnknownUserFieldKeyError` (400 upstream) and NOTHING is written. Each key is
 * upserted on (org_id, brand_id, offer_id, field_key): value is replaced and
 * confirmed_at / updated_at bumped to NOW().
 */
export async function upsertUserFieldsForOffer(
  orgId: string,
  brandId: string,
  offerId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(fields);

  // Validate ALL keys before writing anything (fail loud, atomic-ish).
  for (const [key] of entries) {
    if (!isUserFacingFieldKey(key)) {
      throw new UnknownUserFieldKeyError(key);
    }
  }

  if (entries.length === 0) return;

  const nowIso = new Date().toISOString();

  for (const [fieldKey, value] of entries) {
    await db
      .insert(brandUserFields)
      .values({
        orgId,
        brandId,
        offerId,
        fieldKey,
        value: value as any,
        confirmedAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [
          brandUserFields.orgId,
          brandUserFields.brandId,
          brandUserFields.offerId,
          brandUserFields.fieldKey,
        ],
        set: {
          value: value as any,
          confirmedAt: nowIso,
          updatedAt: nowIso,
        },
      });
  }
}

/**
 * TRANSITIONAL brand-scoped write. It lands on the brand's earliest offer, and
 * creates one from the brand's own name when the pair has none — a write has to
 * go somewhere, and refusing it would break the contract this transition exists
 * to keep. See `resolveOrCreateLegacyOfferId`.
 */
export async function upsertUserFields(
  orgId: string,
  brandId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  // Validate BEFORE resolving an offer, so a rejected write never has the side
  // effect of creating one.
  for (const key of Object.keys(fields)) {
    if (!isUserFacingFieldKey(key)) throw new UnknownUserFieldKeyError(key);
  }
  if (Object.keys(fields).length === 0) return;

  const offerId = await resolveOrCreateLegacyOfferId(orgId, brandId);
  return upsertUserFieldsForOffer(orgId, brandId, offerId, fields);
}
