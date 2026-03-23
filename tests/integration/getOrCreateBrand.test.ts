import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';
import { getOrCreateBrand, getBrand } from '../../src/services/brandService';

/**
 * CRITICAL UNIT TESTS for getOrCreateBrand
 *
 * This is the core function that creates brands in the database.
 * If this fails, brands are NOT created and the entire pipeline breaks.
 */
describe('getOrCreateBrand - CRITICAL', () => {
  const testPrefix = 'test-gocb-';

  // Clean up test data after each test
  afterEach(async () => {
    try {
      await db.delete(brands).where(like(brands.orgId, `${testPrefix}%`));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should CREATE a new brand when none exists', async () => {
    const orgId = `${testPrefix}${Date.now()}_new`;
    const url = 'https://new-brand-test.example.com';
    const expectedDomain = 'new-brand-test.example.com';

    // Verify no brand exists yet
    const brandBefore = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(brandBefore.length).toBe(0);

    // Call getOrCreateBrand
    const result = await getOrCreateBrand(orgId, url);

    // Verify brand was created
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.domain).toBe(expectedDomain);
    expect(result.url).toBe(url);

    // Double-check by querying DB directly
    const after = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));

    expect(after.length).toBe(1);
    expect(after[0].id).toBe(result.id);
    expect(after[0].domain).toBe(expectedDomain);
    expect(after[0].url).toBe(url);
  }, 10000);

  it('should RETURN existing brand when orgId+domain already exists', async () => {
    const orgId = `${testPrefix}${Date.now()}_existing`;
    const url = 'https://existing-brand.example.com';

    // First call creates the brand
    const first = await getOrCreateBrand(orgId, url);
    expect(first).toBeDefined();
    expect(first.id).toBeDefined();

    // Second call should return the same brand
    const second = await getOrCreateBrand(orgId, url);
    expect(second).toBeDefined();
    expect(second.id).toBe(first.id);

    // Verify only one brand exists
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));

    expect(allBrands.length).toBe(1);
  }, 10000);

  it('should UPDATE URL when brand exists with different URL (same domain)', async () => {
    const orgId = `${testPrefix}${Date.now()}_update`;
    const originalUrl = 'https://update-test.example.com/original';
    const newUrl = 'https://update-test.example.com/new-path';

    // Create brand with original URL
    const first = await getOrCreateBrand(orgId, originalUrl);
    expect(first.url).toBe(originalUrl);

    // Update with new URL (same domain)
    const second = await getOrCreateBrand(orgId, newUrl);
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
      const orgId = `${testPrefix}${Date.now()}_domain_${i}`;

      const result = await getOrCreateBrand(orgId, url);
      expect(result.domain).toBe(expectedDomain);
    }
  }, 30000);

  it('should CREATE a second brand when same org uses a different domain', async () => {
    const orgId = `${testPrefix}${Date.now()}_multi`;
    const url1 = 'https://brandone.example.com';
    const url2 = 'https://growthservice.example.com';

    // Create first brand
    const brand1 = await getOrCreateBrand(orgId, url1);
    expect(brand1.domain).toBe('brandone.example.com');

    // Create second brand with different domain, same org
    const brand2 = await getOrCreateBrand(orgId, url2);
    expect(brand2.domain).toBe('growthservice.example.com');

    // They should be DIFFERENT brands
    expect(brand2.id).not.toBe(brand1.id);

    // Verify first brand is NOT overwritten
    const brand1Check = await getBrand(brand1.id);
    expect(brand1Check).not.toBeNull();
    expect(brand1Check!.domain).toBe('brandone.example.com');
    expect(brand1Check!.url).toBe(url1);

    // Verify both brands exist in DB for this org
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(allBrands.length).toBe(2);
  }, 10000);

  it('should RETURN existing brand when same org+domain is called again', async () => {
    const orgId = `${testPrefix}${Date.now()}_same`;
    const url = 'https://same-domain.example.com';

    const brand1 = await getOrCreateBrand(orgId, url);
    const brand2 = await getOrCreateBrand(orgId, url);

    // Should be the same brand (CASE 1)
    expect(brand2.id).toBe(brand1.id);
  }, 10000);

  it('should handle concurrent calls without creating duplicates', async () => {
    const orgId = `${testPrefix}${Date.now()}_concurrent`;
    const url = 'https://concurrent-test.example.com';

    // Call getOrCreateBrand multiple times concurrently
    const promises = Array(5).fill(null).map(() => getOrCreateBrand(orgId, url));
    const results = await Promise.all(promises);

    // All results should have the same brand ID
    const firstId = results[0].id;
    for (const result of results) {
      expect(result.id).toBe(firstId);
    }

    // Only one brand should exist in DB
    const allBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));

    expect(allBrands.length).toBe(1);
  }, 15000);

  it('should allow two different orgs to create brands with the same domain (no cross-org leak)', async () => {
    const orgId1 = `${testPrefix}${Date.now()}_orgA`;
    const orgId2 = `${testPrefix}${Date.now()}_orgB`;
    const url = 'https://shared-domain.example.com';
    const expectedDomain = 'shared-domain.example.com';

    // Org A creates a brand
    const brandA = await getOrCreateBrand(orgId1, url);
    expect(brandA).toBeDefined();
    expect(brandA.domain).toBe(expectedDomain);

    // Org B creates a brand with the same domain
    const brandB = await getOrCreateBrand(orgId2, url);
    expect(brandB).toBeDefined();
    expect(brandB.domain).toBe(expectedDomain);

    // They must be DIFFERENT brands (different IDs)
    expect(brandB.id).not.toBe(brandA.id);

    // Verify each brand belongs to the correct org
    const brandsA = await db.select().from(brands).where(eq(brands.orgId, orgId1));
    const brandsB = await db.select().from(brands).where(eq(brands.orgId, orgId2));

    expect(brandsA.length).toBe(1);
    expect(brandsB.length).toBe(1);
    expect(brandsA[0].id).toBe(brandA.id);
    expect(brandsB[0].id).toBe(brandB.id);
  }, 15000);
});

describe('getBrand - CRITICAL', () => {
  const testPrefix = 'test-getbrand-';

  afterEach(async () => {
    await db.delete(brands).where(like(brands.orgId, `${testPrefix}%`));
  });

  it('should return null for non-existent brandId', async () => {
    const result = await getBrand('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('should return brand data for existing brandId', async () => {
    const orgId = `${testPrefix}${Date.now()}`;
    const url = 'https://getbrand-test.example.com';

    // Create a brand first
    const created = await getOrCreateBrand(orgId, url);

    // Get the brand by ID
    const result = await getBrand(created.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.url).toBe(url);
    expect(result!.domain).toBe('getbrand-test.example.com');
  }, 10000);
});

describe('Regression: new org without orgs-table row', () => {
  const testOrgId = 'b645207b-d8e9-40b0-9391-072b777cd9a9';

  afterEach(async () => {
    await db.delete(brands).where(eq(brands.orgId, testOrgId));
  });

  it('should create a brand for a UUID orgId that has no row in the legacy orgs table', async () => {
    // This is the exact scenario reported: a new org calls POST /sales-profile
    // but has never been registered in the legacy orgs table.
    // Previously failed with: FK violation brands_org_id_fkey
    const url = 'https://regression-test-new-org.example.com';

    const brand = await getOrCreateBrand(testOrgId, url);

    expect(brand).toBeDefined();
    expect(brand.id).toBeDefined();
    expect(brand.domain).toBe('regression-test-new-org.example.com');
    expect(brand.url).toBe(url);

    // Verify persisted correctly
    const persisted = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, testOrgId));
    expect(persisted.length).toBe(1);
    expect(persisted[0].id).toBe(brand.id);
  }, 10000);
});

describe('Full Flow Integration - CRITICAL', () => {
  const testPrefix = 'test-fullflow-';

  afterEach(async () => {
    await db.delete(brands).where(like(brands.orgId, `${testPrefix}%`));
  });

  it('should create brand and it should be queryable immediately', async () => {
    const orgId = `${testPrefix}${Date.now()}_fullflow`;
    const url = 'https://fullflow-test.distribute.you';

    // Step 1: Verify no brand exists yet
    const brandsBefore = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(brandsBefore.length).toBe(0);

    // Step 2: Create brand via getOrCreateBrand
    const created = await getOrCreateBrand(orgId, url);
    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);

    // Step 3: Query brand by ID
    const byId = await getBrand(created.id);
    expect(byId).not.toBeNull();
    expect(byId!.id).toBe(created.id);

    // Step 4: Query brand by orgId directly from DB
    const byOrgId = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(byOrgId.length).toBe(1);
    expect(byOrgId[0].id).toBe(created.id);

    // Step 5: Query brand by domain directly from DB
    const byDomain = await db
      .select()
      .from(brands)
      .where(eq(brands.domain, 'fullflow-test.distribute.you'));
    expect(byDomain.length).toBe(1);
    expect(byDomain[0].id).toBe(created.id);
  }, 15000);
});
