import { db, brands, mediaAssets, intakeForms, orgs } from '../../src/db';
import { eq, like, or, sql, inArray } from 'drizzle-orm';

/**
 * Clean test data from database
 * Only cleans data created during tests (with test- prefix)
 */
export async function cleanTestData() {
  try {
    // Clean media assets for test brands first (foreign key constraint)
    await db.delete(mediaAssets).where(
      like(mediaAssets.brandId, 'test-%')
    );

    // Clean intake forms for test brands
    await db.delete(intakeForms).where(
      like(intakeForms.brandId, 'test-%')
    );

    // Find test orgs and delete brands via orgId
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.clerkOrgId, 'test-%'));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
    }

    // Clean brands with test prefix external org ids (legacy)
    await db.delete(brands).where(
      like(brands.externalOrganizationId, 'test-%')
    );

    // Clean test orgs
    await db.delete(orgs).where(like(orgs.clerkOrgId, 'test-%'));
  } catch (error) {
    // Table might not exist or connection issue, ignore in tests
    console.log('cleanTestData: ignoring error (table may not exist or DB unavailable)');
  }
}

/**
 * Insert a test org and return its id
 */
export async function insertTestOrg(data?: {
  appId?: string;
  clerkOrgId?: string;
}) {
  const result = await db
    .insert(orgs)
    .values({
      appId: data?.appId || 'mcpfactory',
      clerkOrgId: data?.clerkOrgId || `test-clerk-${Date.now()}`,
    })
    .returning();

  return result[0];
}

/**
 * Insert a test brand (requires an orgId)
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
 * Generate a random test ID
 */
export function randomTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
