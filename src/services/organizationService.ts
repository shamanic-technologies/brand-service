import { eq } from 'drizzle-orm';
import { db, brands, brandRelations } from '../db';

/**
 * Finds all related brands (target) for a given source brand URL.
 */
export const getOrganizationRelationsByUrl = async (sourceOrganizationUrl: string) => {
  // First find the source brand by URL
  const sourceBrand = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.url, sourceOrganizationUrl))
    .limit(1);

  if (sourceBrand.length === 0) {
    return [];
  }

  const sourceBrandId = sourceBrand[0].id;

  // Get all relations with target brand details
  const results = await db
    .select({
      targetBrandId: brandRelations.targetBrandId,
      relationType: brandRelations.relationType,
      relationConfidenceLevel: brandRelations.relationConfidenceLevel,
      relationConfidenceRationale: brandRelations.relationConfidenceRationale,
      createdAt: brandRelations.createdAt,
      updatedAt: brandRelations.updatedAt,
      targetBrandName: brands.name,
      targetBrandUrl: brands.url,
    })
    .from(brandRelations)
    .innerJoin(brands, eq(brandRelations.targetBrandId, brands.id))
    .where(eq(brandRelations.sourceBrandId, sourceBrandId));

  return results.map(row => ({
    target_organization_id: row.targetBrandId,
    target_organization_name: row.targetBrandName,
    target_organization_url: row.targetBrandUrl,
    relation_type: row.relationType,
    relation_confidence_level: row.relationConfidenceLevel,
    relation_confidence_rationale: row.relationConfidenceRationale,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
};
