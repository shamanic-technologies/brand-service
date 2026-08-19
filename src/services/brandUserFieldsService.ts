import { eq, and, isNull, or, gt, desc, inArray, sql } from 'drizzle-orm';
import { db, brandUserFields, brandExtractedFields } from '../db';
import { offerScope, resolveOfferForWrite, resolveSoleOffer } from './brandOffersService';

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
 * Read the confirmed (user-validated) fields of ONE offer as a Map keyed by
 * field key. Only the 7 user-facing keys can ever be present (DB CHECK).
 *
 * There is deliberately no brand-scoped sibling of this read anymore. Every
 * reader now states which proposition it is asking about — by naming an offer,
 * or by resolving one through `resolveNamedOffer`, which still refuses a brand
 * selling several rather than picking one.
 *
 * `null` reads the rows the migration has not reached, which — scoped by org and
 * brand — is byte-for-byte what this query answered before offers existed. It is
 * also what an empty brand answers: nothing confirmed.
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
        offerScope(brandUserFields.offerId, offerId),
      ),
    );

  const map = new Map<string, ConfirmedUserField>();
  for (const row of rows) {
    map.set(row.fieldKey, { value: row.value, confirmedAt: row.confirmedAt });
  }
  return map;
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
 * The full user-fields view for a brand: all 7 keys, each tagged `confirmed`
 * (user-validated value) or `suggested` (auto-extract prefill or null). Does NOT
 * trigger extraction.
 */
export async function getUserFieldsView(orgId: string, brandId: string): Promise<Record<string, UserFieldView>> {
  return getUserFieldsViewByOfferId(orgId, brandId, await resolveSoleOffer(orgId, brandId));
}

/**
 * The same view, for ONE named offer.
 *
 * The CONFIRMED half is the offer's — a dream outcome and a risk reversal are
 * claims about one thing a brand sells. The SUGGESTED half stays BRAND-wide and
 * deliberately so: it is the auto-extract prefill read off the brand's own site,
 * which describes the company and knows nothing about which of its products a
 * reader is looking at. Every offer of a brand therefore prefills from the same
 * extraction and diverges the moment a human confirms anything.
 */
export async function getUserFieldsViewByOfferId(
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
 * Upsert one or more confirmed user fields for a brand. Every supplied key MUST
 * be one of the 7 user-facing keys — an unknown key throws
 * `UnknownUserFieldKeyError` (400 upstream) and NOTHING is written. Each key is
 * upserted on (brand_id, field_key): value is replaced and confirmed_at /
 * updated_at bumped to NOW().
 */
export async function upsertUserFields(
  orgId: string,
  brandId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(fields);

  // Validate ALL keys before writing anything, and before resolving an offer:
  // a rejected body must not have created a brand's first offer on its way out.
  for (const [key] of entries) {
    if (!isUserFacingFieldKey(key)) {
      throw new UnknownUserFieldKeyError(key);
    }
  }

  if (entries.length === 0) return;

  return upsertUserFieldsByOfferId(
    orgId,
    brandId,
    await resolveOfferForWrite(orgId, brandId),
    fields,
  );
}

/** The same upsert, against ONE named offer. */
export async function upsertUserFieldsByOfferId(
  orgId: string,
  brandId: string,
  offerId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(fields);

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
        // The natural key is the OFFER and the field: two offers of one brand
        // legitimately make different claims under the same lever.
        target: [brandUserFields.offerId, brandUserFields.fieldKey],
        set: {
          value: value as any,
          confirmedAt: nowIso,
          updatedAt: nowIso,
        },
      });
  }
}
