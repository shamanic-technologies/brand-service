import { eq, and, isNull, or, gt, desc, inArray, sql } from 'drizzle-orm';
import { db, brandUserFields, brandExtractedFields } from '../db';
import { offerScope, resolveOfferForWrite, resolveSoleOffer } from './brandOffersService';

/**
 * The 8 user-facing "confirmed" field keys. A value the user validates in the
 * dashboard is stored durably (no TTL) in `brand_user_fields`. `dreamOutcome`
 * REPLACES the old `valueProposition` in the user-facing set — `valueProposition`
 * is NOT user-facing anymore (it stays a pure backend-extract field).
 *
 * `targetAudience` joined on 2026-09-19: the dashboard's onboarding asks "Who do
 * you sell to?" and saves the answer here (distribute.you#4294), so a person's
 * own words outrank the extracted guess the way the seven levers do. Until it
 * was admitted, every new signup's write was refused with a 400 and the visitor
 * could not pass the step.
 *
 * `giveForFree` and `neverGive` joined on 2026-09-29, both string[] lists about
 * ONE offer: what the customer is willing to hand a prospect who replies (a free
 * audit, a trial, a sample) and what an email must never promise (a discount,
 * free implementation). Stored, served and prefilled exactly like the levers, so
 * every reader of an offer's confirmed fields (the brand profile, the
 * extract-fields overlay the email writer reads) carries them with no change.
 */
export const USER_FACING_FIELD_KEYS = [
  'services',
  'dreamOutcome',
  'perceivedLikelihood',
  'socialProof',
  'riskReversal',
  'urgency',
  'scarcity',
  'targetAudience',
  'giveForFree',
  'neverGive',
] as const;

export type UserFacingFieldKey = (typeof USER_FACING_FIELD_KEYS)[number];

const USER_FACING_KEY_SET: ReadonlySet<string> = new Set(USER_FACING_FIELD_KEYS);

export function isUserFacingFieldKey(key: string): key is UserFacingFieldKey {
  return USER_FACING_KEY_SET.has(key);
}

/** Thrown when an upsert carries a key outside the user-facing keys → 400 upstream. */
export class UnknownUserFieldKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown user field key: "${key}". Allowed keys: ${USER_FACING_FIELD_KEYS.join(', ')}`);
    this.name = 'UnknownUserFieldKeyError';
  }
}

/**
 * A CLEARED confirmation: `null` (or absent) or a blank string. Clearing a
 * confirmed field means "stop overriding the site": the confirmation goes and
 * every read serves the site-extracted value again. Before 2026-10-19 a cleared
 * field was stored as a `confirmed` row with value NULL — the profile read
 * dropped it (site value shown) while the extract-fields overlay the email
 * writer reads served `null`, so emails lost the lever entirely.
 *
 * An EMPTY LIST is NOT a clear: `giveForFree: []` / `neverGive: []` is the
 * customer stating "nothing", saved on purpose by the dashboard, and must not
 * fall back to a site-guessed freebie an email would then promise.
 */
export function isClearedUserFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
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
    // A row left by the pre-2026-10-19 clear (value NULL / blank) confirms
    // nothing: skip it so EVERY reader (profile, extract-fields overlay, the
    // user-fields view) falls back to the site value alike.
    if (isClearedUserFieldValue(row.value)) continue;
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
 * Upsert one or more confirmed user fields for a brand. A `null` / blank value
 * CLEARS the confirmation (row deleted, site value served). Every supplied key MUST
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
    // Clearing removes the confirmation (no NULL `confirmed` row): the site
    // value takes over on every read.
    if (isClearedUserFieldValue(value)) {
      await db
        .delete(brandUserFields)
        .where(
          and(
            eq(brandUserFields.orgId, orgId),
            eq(brandUserFields.brandId, brandId),
            eq(brandUserFields.offerId, offerId),
            eq(brandUserFields.fieldKey, fieldKey),
          ),
        );
      continue;
    }
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
