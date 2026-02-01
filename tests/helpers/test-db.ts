import { db, brands, mediaAssets, supabaseStorage, intakeForms } from '../../src/db';
import { eq, like, or, sql } from 'drizzle-orm';

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

    // Clean brands with test prefix
    await db.delete(brands).where(
      or(
        like(brands.clerkOrgId, 'test-%'),
        like(brands.externalOrganizationId, 'test-%')
      )
    );
  } catch (error) {
    // Table might not exist or connection issue, ignore in tests
    console.log('cleanTestData: ignoring error (table may not exist or DB unavailable)');
  }
}

/**
 * Insert a test brand
 */
export async function insertTestBrand(data: {
  clerkOrgId?: string;
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
      clerkOrgId: data.clerkOrgId || `test-clerk-${Date.now()}`,
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
