import { randomUUID } from 'crypto';
import { db, brands, brandsOld, orgBrands, mediaAssets, intakeForms } from '../../src/db';
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

    // Clean memberships for test orgs (then brand cascades via FK).
    await db.delete(orgBrands).where(
      sql`${orgBrands.orgId}::text LIKE 'test-%'`,
    );

    // Clean legacy brands rows with test prefix org IDs / external IDs.
    await db.delete(brandsOld).where(
      sql`${brandsOld.orgId}::text LIKE 'test-%'`,
    );
    await db.delete(brandsOld).where(
      like(brandsOld.externalOrganizationId, 'test-%'),
    );
  } catch (error) {
    // Table might not exist or connection issue, ignore in tests
    console.log('cleanTestData: ignoring error (table may not exist or DB unavailable)');
  }
}

/**
 * Insert a test brand directly. Writes the silver brand row, the org_brands
 * membership, and the legacy `brands_old` row (with the same id + org_id)
 * so that legacy-bridge routes that still read brands_old keep working in
 * tests.
 */
export async function insertTestBrand(data: {
  orgId: string;
  externalOrganizationId?: string;
  name?: string;
  url?: string;
  domain?: string;
}) {
  const id = randomTestId();
  const url = data.url || 'https://test.example.com';
  const domain = data.domain || 'test.example.com';
  const name = data.name || 'Test Brand';
  const externalOrganizationId = data.externalOrganizationId || `test-ext-${Date.now()}`;

  await db.insert(brands).values({ id, url, domain, name });
  await db.insert(orgBrands).values({ orgId: data.orgId, brandId: id }).onConflictDoNothing();
  const legacy = await db
    .insert(brandsOld)
    .values({
      id,
      orgId: data.orgId,
      externalOrganizationId,
      name,
      url,
      domain,
    })
    .returning();

  return legacy[0];
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
 * Delete brands by a list of orgIds (for test cleanup). Removes the gold
 * memberships, the legacy `brands_old` rows, and any silver brand row
 * orphaned by the membership delete.
 */
export async function deleteBrandsByOrgIds(orgIds: string[]) {
  if (orgIds.length === 0) return;
  const memberRows = await db
    .select({ brandId: orgBrands.brandId })
    .from(orgBrands)
    .where(inArray(orgBrands.orgId, orgIds));
  const brandIds = Array.from(new Set(memberRows.map((m) => m.brandId)));

  await db.delete(orgBrands).where(inArray(orgBrands.orgId, orgIds));
  await db.delete(brandsOld).where(inArray(brandsOld.orgId, orgIds));

  if (brandIds.length > 0) {
    // Drop silver brand rows that no longer have any membership.
    const stillReferenced = await db
      .select({ brandId: orgBrands.brandId })
      .from(orgBrands)
      .where(inArray(orgBrands.brandId, brandIds));
    const referencedSet = new Set(stillReferenced.map((r) => r.brandId));
    const orphaned = brandIds.filter((id) => !referencedSet.has(id));
    if (orphaned.length > 0) {
      await db.delete(brands).where(inArray(brands.id, orphaned));
    }
  }
}
