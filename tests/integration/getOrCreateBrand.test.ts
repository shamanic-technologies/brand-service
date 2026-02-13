import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../src/db';
import { brands, brandSalesProfiles, orgs } from '../../src/db/schema';
import { eq, and, like, inArray } from 'drizzle-orm';
import { getOrCreateBrand, getBrand, getExistingSalesProfile } from '../../src/services/salesProfileExtractionService';

/**
 * CRITICAL UNIT TESTS for getOrCreateBrand
 *
 * This is the core function that creates brands in the database.
 * If this fails, brands are NOT created and the entire pipeline breaks.
 */
describe('getOrCreateBrand - CRITICAL', () => {
  const testPrefix = 'test_gocb_';

  // Clean up test data after each test
  afterEach(async () => {
    try {
      // Find test orgs, delete brands via orgId, then delete orgs
      const testOrgs = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(like(orgs.clerkOrgId, `${testPrefix}%`));

      if (testOrgs.length > 0) {
        const orgIds = testOrgs.map(o => o.id);
        await db.delete(brands).where(inArray(brands.orgId, orgIds));
      }
      await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should CREATE a new brand when none exists', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_new`;
    const url = 'https://new-brand-test.example.com';
    const expectedDomain = 'new-brand-test.example.com';

    // Verify no org exists yet
    const orgBefore = await db
      .select()
      .from(orgs)
      .where(eq(orgs.clerkOrgId, clerkOrgId));
    expect(orgBefore.length).toBe(0);

    // Call getOrCreateBrand
    const result = await getOrCreateBrand(clerkOrgId, url);

    // Verify brand was created
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.domain).toBe(expectedDomain);
    expect(result.url).toBe(url);

    // Double-check by querying DB directly via org
    const [org] = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    expect(org).toBeDefined();

    const after = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));

    expect(after.length).toBe(1);
    expect(after[0].id).toBe(result.id);
    expect(after[0].domain).toBe(expectedDomain);
    expect(after[0].url).toBe(url);
  }, 10000);

  it('should RETURN existing brand when clerkOrgId+domain already exists', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_existing`;
    const url = 'https://existing-brand.example.com';

    // First call creates the brand
    const first = await getOrCreateBrand(clerkOrgId, url);
    expect(first).toBeDefined();
    expect(first.id).toBeDefined();

    // Second call should return the same brand
    const second = await getOrCreateBrand(clerkOrgId, url);
    expect(second).toBeDefined();
    expect(second.id).toBe(first.id);

    // Verify only one brand exists
    const [org] = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));

    expect(allBrands.length).toBe(1);
  }, 10000);

  it('should UPDATE URL when brand exists with different URL (same domain)', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_update`;
    const originalUrl = 'https://update-test.example.com/original';
    const newUrl = 'https://update-test.example.com/new-path';

    // Create brand with original URL
    const first = await getOrCreateBrand(clerkOrgId, originalUrl);
    expect(first.url).toBe(originalUrl);

    // Update with new URL (same domain)
    const second = await getOrCreateBrand(clerkOrgId, newUrl);
    expect(second.id).toBe(first.id); // Same brand
    expect(second.url).toBe(newUrl); // URL updated
  }, 10000);

  it('should extract domain correctly from various URL formats', async () => {
    const testCases = [
      { url: 'https://www.example.com', expectedDomain: 'example.com' },
      { url: 'https://example.com', expectedDomain: 'example.com' },
      { url: 'http://example.com', expectedDomain: 'example.com' },
      { url: 'https://sub.example.com', expectedDomain: 'sub.example.com' },
      { url: 'https://example.com/path/to/page', expectedDomain: 'example.com' },
      { url: 'https://www.example.com:8080/path', expectedDomain: 'example.com' },
    ];

    for (let i = 0; i < testCases.length; i++) {
      const { url, expectedDomain } = testCases[i];
      const clerkOrgId = `${testPrefix}${Date.now()}_domain_${i}`;

      const result = await getOrCreateBrand(clerkOrgId, url);
      expect(result.domain).toBe(expectedDomain);
    }
  }, 30000);

  it('should CREATE a second brand when same org uses a different domain', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_multi`;
    const url1 = 'https://mcpfactory.example.com';
    const url2 = 'https://growthservice.example.com';

    // Create first brand
    const brand1 = await getOrCreateBrand(clerkOrgId, url1);
    expect(brand1.domain).toBe('mcpfactory.example.com');

    // Create second brand with different domain, same org
    const brand2 = await getOrCreateBrand(clerkOrgId, url2);
    expect(brand2.domain).toBe('growthservice.example.com');

    // They should be DIFFERENT brands
    expect(brand2.id).not.toBe(brand1.id);

    // Verify first brand is NOT overwritten
    const brand1Check = await getBrand(brand1.id);
    expect(brand1Check).not.toBeNull();
    expect(brand1Check!.domain).toBe('mcpfactory.example.com');
    expect(brand1Check!.url).toBe(url1);

    // Verify both brands exist in DB for this org
    const [org] = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(allBrands.length).toBe(2);
  }, 10000);

  it('should RETURN existing brand when same org+domain is called again', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_same`;
    const url = 'https://same-domain.example.com';

    const brand1 = await getOrCreateBrand(clerkOrgId, url);
    const brand2 = await getOrCreateBrand(clerkOrgId, url);

    // Should be the same brand (CASE 1)
    expect(brand2.id).toBe(brand1.id);
  }, 10000);

  it('should handle concurrent calls without creating duplicates', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_concurrent`;
    const url = 'https://concurrent-test.example.com';

    // Call getOrCreateBrand multiple times concurrently
    const promises = Array(5).fill(null).map(() => getOrCreateBrand(clerkOrgId, url));
    const results = await Promise.all(promises);

    // All results should have the same brand ID
    const firstId = results[0].id;
    for (const result of results) {
      expect(result.id).toBe(firstId);
    }

    // Only one brand should exist in DB
    const [org] = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));

    expect(allBrands.length).toBe(1);
  }, 15000);
});

describe('getBrand - CRITICAL', () => {
  const testPrefix = 'test_getbrand_';

  afterEach(async () => {
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.clerkOrgId, `${testPrefix}%`));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
    }
    await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
  });

  it('should return null for non-existent brandId', async () => {
    const result = await getBrand('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('should return brand data for existing brandId', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}`;
    const url = 'https://getbrand-test.example.com';

    // Create a brand first
    const created = await getOrCreateBrand(clerkOrgId, url);

    // Get the brand by ID
    const result = await getBrand(created.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.url).toBe(url);
    expect(result!.domain).toBe('getbrand-test.example.com');
  }, 10000);
});

describe('getExistingSalesProfile - CRITICAL', () => {
  const testPrefix = 'test_getprofile_';

  afterEach(async () => {
    // Clean up: delete profiles first, then brands, then orgs
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.clerkOrgId, `${testPrefix}%`));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(inArray(brands.orgId, orgIds));

      for (const brand of testBrands) {
        await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
      }
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
    }
    await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
  });

  it('should return null for brand with no profile', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}`;
    const url = 'https://no-profile.example.com';

    // Create brand
    const brand = await getOrCreateBrand(clerkOrgId, url);

    // Get profile (should be null)
    const result = await getExistingSalesProfile(brand.id);
    expect(result).toBeNull();
  }, 10000);
});

describe('Full Flow Integration - CRITICAL', () => {
  const testPrefix = 'test_fullflow_';

  afterEach(async () => {
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.clerkOrgId, `${testPrefix}%`));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(inArray(brands.orgId, orgIds));

      for (const brand of testBrands) {
        await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
      }
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
    }
    await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
  });

  it('should create brand and it should be queryable immediately', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_fullflow`;
    const url = 'https://fullflow-test.mcpfactory.org';

    // Step 1: Verify no org exists yet
    const orgsBefore = await db
      .select()
      .from(orgs)
      .where(eq(orgs.clerkOrgId, clerkOrgId));
    expect(orgsBefore.length).toBe(0);

    // Step 2: Create brand via getOrCreateBrand
    const created = await getOrCreateBrand(clerkOrgId, url);
    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);

    // Step 3: Query brand by ID
    const byId = await getBrand(created.id);
    expect(byId).not.toBeNull();
    expect(byId!.id).toBe(created.id);

    // Step 4: Query brand by orgId directly from DB
    const [org] = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    const byOrgId = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(byOrgId.length).toBe(1);
    expect(byOrgId[0].id).toBe(created.id);

    // Step 5: Query brand by domain directly from DB
    const byDomain = await db
      .select()
      .from(brands)
      .where(eq(brands.domain, 'fullflow-test.mcpfactory.org'));
    expect(byDomain.length).toBe(1);
    expect(byDomain[0].id).toBe(created.id);
  }, 15000);
});
