import { eq, and, isNull, or, gt, desc, inArray, sql } from 'drizzle-orm';
import { db, brandUserFields, brandExtractedFields } from '../db';

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
 * Read the confirmed (user-validated) fields for a brand as a Map keyed by
 * field key. Only the 7 user-facing keys can ever be present (DB CHECK).
 */
export async function getConfirmedByBrandId(
  brandId: string,
): Promise<Map<string, ConfirmedUserField>> {
  const rows = await db
    .select({
      fieldKey: brandUserFields.fieldKey,
      value: brandUserFields.value,
      confirmedAt: brandUserFields.confirmedAt,
    })
    .from(brandUserFields)
    .where(eq(brandUserFields.brandId, brandId));

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
export async function getSuggestedByBrandId(brandId: string): Promise<Map<string, unknown>> {
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
export async function getUserFieldsView(brandId: string): Promise<Record<string, UserFieldView>> {
  const [confirmed, suggested] = await Promise.all([
    getConfirmedByBrandId(brandId),
    getSuggestedByBrandId(brandId),
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
  brandId: string,
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
        brandId,
        fieldKey,
        value: value as any,
        confirmedAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [brandUserFields.brandId, brandUserFields.fieldKey],
        set: {
          value: value as any,
          confirmedAt: nowIso,
          updatedAt: nowIso,
        },
      });
  }
}
