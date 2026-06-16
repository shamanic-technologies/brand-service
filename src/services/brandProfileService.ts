import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { db, brandProfileVersions, brandExtractedFields, brands } from '../db';

export type ProfileFields = Record<string, string | string[]>;

export interface BrandProfileVersion {
  id: string;
  brandId: string;
  version: number;
  fields: ProfileFields;
  createdAt: string;
}

export interface VersionSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface BrandProfileResponse {
  current: BrandProfileVersion | null;
  versions: VersionSummary[];
}

/**
 * Extracted-field keys that describe the TARGET AUDIENCE, not the brand's own
 * info — excluded from the derived brand profile because audience lives in
 * personas. Plus `name` (brand identity, not profile content).
 * May evolve as the extraction vocabulary grows.
 */
const EXCLUDED_FIELD_KEYS = new Set(['name', 'targetAudience', 'customerPainPoints']);

type ExtractedFieldRow = { fieldKey: string; fieldValue: unknown };

/**
 * Coerce raw brand_extracted_fields rows into a brand-profile `fields` map.
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

type VersionRow = typeof brandProfileVersions.$inferSelect;

function formatVersion(row: VersionRow): BrandProfileVersion {
  return {
    id: row.id,
    brandId: row.brandId,
    version: row.version,
    fields: row.fields,
    createdAt: row.createdAt,
  };
}

export class BrandProfileService {
  /**
   * Derive a virtual v1 profile from the brand's extracted fields. NOT
   * persisted — returned as the `current` for a brand that has never saved a
   * version, so the page is never empty. Synthetic id, version 1.
   */
  async deriveVirtualV1(brandId: string): Promise<BrandProfileVersion> {
    const rows = await db
      .select({ fieldKey: brandExtractedFields.fieldKey, fieldValue: brandExtractedFields.fieldValue })
      .from(brandExtractedFields)
      .where(and(eq(brandExtractedFields.brandId, brandId), isNull(brandExtractedFields.campaignId)));

    const fields = coerceProfileFields(rows);

    const [brand] = await db
      .select({ createdAt: brands.createdAt })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);

    return {
      id: `derived-${brandId}`,
      brandId,
      version: 1,
      fields,
      createdAt: brand?.createdAt ?? new Date().toISOString(),
    };
  }

  /** Saved versions (newest first) — id/version/createdAt summaries. */
  private async listVersions(brandId: string): Promise<VersionRow[]> {
    return db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.brandId, brandId))
      .orderBy(desc(brandProfileVersions.version));
  }

  /**
   * GET payload: the latest saved version as `current` (or a derived virtual v1
   * when none saved) plus the saved-version summary list.
   */
  async getByBrandId(brandId: string): Promise<BrandProfileResponse> {
    const rows = await this.listVersions(brandId);

    if (rows.length === 0) {
      const current = await this.deriveVirtualV1(brandId);
      return { current, versions: [] };
    }

    const summaries: VersionSummary[] = rows.map((r) => ({
      id: r.id,
      version: r.version,
      createdAt: r.createdAt,
    }));

    return { current: formatVersion(rows[0]), versions: summaries };
  }

  /**
   * Save a new immutable version (= max(version)+1 for the brand). Prior
   * versions are never touched. Serializes concurrent writers per brand with a
   * FOR UPDATE lock on the brand row so two parallel saves can't collide on the
   * (brand_id, version) unique index.
   */
  async createVersion(brandId: string, fields: ProfileFields): Promise<BrandProfileVersion> {
    return db.transaction(async (tx) => {
      // Lock the brand row to serialize per-brand version assignment.
      await tx.execute(sql`SELECT id FROM brands WHERE id = ${brandId} FOR UPDATE`);

      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number | null>`MAX(${brandProfileVersions.version})` })
        .from(brandProfileVersions)
        .where(eq(brandProfileVersions.brandId, brandId));

      const nextVersion = (maxVersion ?? 0) + 1;

      const [row] = await tx
        .insert(brandProfileVersions)
        .values({ brandId, version: nextVersion, fields })
        .returning();

      return formatVersion(row);
    });
  }
}

export const brandProfileService = new BrandProfileService();
