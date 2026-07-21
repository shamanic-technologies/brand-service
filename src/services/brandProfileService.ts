import { eq, and, isNull } from 'drizzle-orm';
import { db, brandExtractedFields } from '../db';
import { getConfirmedByBrandId } from './brandUserFieldsService';

export type ProfileFields = Record<string, string | string[]>;

export interface BrandProfileResponse {
  /**
   * The brand's OWN-info fields: the confirmed (user-validated) 7 overlaid on
   * the fields derived from the ephemeral extract cache. Never null — an empty
   * map when nothing is known yet.
   */
  current: { fields: ProfileFields };
  /** True when the brand has ≥1 confirmed (user-validated) field row. */
  hasConfirmed: boolean;
  /**
   * ONLY the confirmed (user-validated) fields, coerced. This is the sole
   * client-validated truth injected into the extraction prompt — the derived
   * fields are our own past extractions and must NOT be fed back as authoritative.
   */
  confirmedFields: ProfileFields;
}

/**
 * Extracted-field keys that describe the TARGET AUDIENCE, not the brand's own
 * info — excluded from the derived brand profile (audience is owned elsewhere).
 * Plus `name` (brand identity, not profile content).
 * May evolve as the extraction vocabulary grows.
 */
const EXCLUDED_FIELD_KEYS = new Set(['name', 'targetAudience', 'customerPainPoints']);

type ExtractedFieldRow = { fieldKey: string; fieldValue: unknown };

/**
 * Coerce raw field rows into a brand-profile `fields` map.
 * - string  → kept as-is
 * - string[] → kept (non-string elements stringified; empty arrays dropped)
 * - everything else (objects, numbers, null) → dropped (not string|string[])
 * Audience/identity keys are excluded. Pure — unit-tested in isolation.
 */
export function coerceProfileFields(rows: ExtractedFieldRow[]): ProfileFields {
  const fields: ProfileFields = {};
  for (const { fieldKey, fieldValue } of rows) {
    if (EXCLUDED_FIELD_KEYS.has(fieldKey)) continue;
    if (typeof fieldValue === 'string') {
      if (fieldValue.trim().length === 0) continue;
      fields[fieldKey] = fieldValue;
    } else if (Array.isArray(fieldValue)) {
      const items = fieldValue
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v))
        .filter((v) => v.trim().length > 0);
      if (items.length > 0) fields[fieldKey] = items;
    }
    // objects / numbers / null → dropped
  }
  return fields;
}

export class BrandProfileService {
  /**
   * The brand's own-info profile: confirmed (user-validated) fields overlaid on
   * the fields derived from the ephemeral extract cache. `confirmedFields` is the
   * confirmed layer alone; `hasConfirmed` gates injecting it as authoritative.
   */
  async getByBrandId(brandId: string): Promise<BrandProfileResponse> {
    const [extractedRows, confirmedMap] = await Promise.all([
      db
        .select({ fieldKey: brandExtractedFields.fieldKey, fieldValue: brandExtractedFields.fieldValue })
        .from(brandExtractedFields)
        .where(and(eq(brandExtractedFields.brandId, brandId), isNull(brandExtractedFields.campaignId))),
      getConfirmedByBrandId(brandId),
    ]);

    const derived = coerceProfileFields(extractedRows);
    const confirmedFields = coerceProfileFields(
      Array.from(confirmedMap.entries()).map(([fieldKey, { value }]) => ({ fieldKey, fieldValue: value })),
    );

    return {
      current: { fields: { ...derived, ...confirmedFields } },
      hasConfirmed: confirmedMap.size > 0,
      confirmedFields,
    };
  }
}

export const brandProfileService = new BrandProfileService();
