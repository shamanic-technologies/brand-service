import { randomUUID } from 'crypto';
import { db, brands, mediaAssets, intakeForms } from '../../src/db';
import { eq, like, sql, inArray } from 'drizzle-orm';

/**
 * Clean test data from database
 * Only cleans data created during tests (with test- prefix)
 * Note: orgId and brandId are uuid columns — LIKE requires cast to text
 */
export async function cleanTestData() {
  try {
    // Clean media assets for test brands first (foreign key constraint)
    await db.delete(mediaAssets).where(
      sql`${mediaAssets.brandId}::text LIKE 'test-%'`
    );

    // Clean intake forms for test brands
    await db.delete(intakeForms).where(
      sql`${intakeForms.brandId}::text LIKE 'test-%'`
    );

    // Clean brands with test prefix org IDs
    await db.delete(brands).where(
      sql`${brands.orgId}::text LIKE 'test-%'`
    );

    // Clean brands with test prefix external org ids (legacy)
    await db.delete(brands).where(
      like(brands.externalOrganizationId, 'test-%')
    );
  } catch (error) {
    // Table might not exist or connection issue, ignore in tests
    console.log('cleanTestData: ignoring error (table may not exist or DB unavailable)');
  }
}

/**
 * Insert a test brand directly (orgId is now client-service UUID, no orgs table indirection)
 */
export async function insertTestBrand(data: {
  orgId: string;
  externalOrganizationId?: string;
  name?: string;
  url?: string;
  domain?: string;
}) {
  const id = randomTestId();
  const result = await db
    .insert(brands)
    .values({
      id,
      orgId: data.orgId,
      externalOrganizationId: data.externalOrganizationId || `test-ext-${Date.now()}`,
      name: data.name || 'Test Brand',
      url: data.url || 'https://test.example.com',
      domain: data.domain || 'test.example.com',
    })
    .returning();

  return result[0];
}

/**
 * Insert a test media asset
 */
export async function insertTestMediaAsset(brandId: string, data?: {
  assetUrl?: string;
  assetType?: string;
  caption?: string;
}) {
  const id = randomTestId();
  const result = await db
    .insert(mediaAssets)
    .values({
      id,
      brandId,
      assetUrl: data?.assetUrl || `https://storage.test.com/${id}.jpg`,
      assetType: data?.assetType || 'uploaded_file',
      caption: data?.caption || null,
      isShareable: true,
    })
    .returning();

  return result[0];
}

/**
 * Get a brand by ID
 */
export async function getBrandById(id: string) {
  const result = await db
    .select()
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Close database connection
 */
export async function closeDb() {
  // Drizzle/postgres.js manages connections automatically
  // This is a no-op for compatibility
}

/**
 * Generate a random test ID (UUID format for uuid columns)
 */
export function randomTestId(): string {
  return randomUUID();
}

/**
 * Delete brands by a list of orgIds (for test cleanup)
 */
export async function deleteBrandsByOrgIds(orgIds: string[]) {
  if (orgIds.length === 0) return;
  await db.delete(brands).where(inArray(brands.orgId, orgIds));
}
