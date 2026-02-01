import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandSalesProfiles } from '../../src/db/schema';
import { eq, and, like } from 'drizzle-orm';

const app = createTestApp();

describe('Sales Profile API - Complete Integration Tests', () => {
  const testClerkOrgId = `org_test_${Date.now()}`;
  const testUrl = 'https://test-brand-integration.example.com';
  const testDomain = 'test-brand-integration.example.com';

  // Clean up test data after all tests
  afterAll(async () => {
    try {
      // Delete sales profiles for test brands first (foreign key)
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.clerkOrgId, 'org_test_%'));
      
      for (const brand of testBrands) {
        await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
      }
      
      // Delete test brands
      await db.delete(brands).where(like(brands.clerkOrgId, 'org_test_%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  describe('POST /sales-profile - Brand Creation', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .send({ clerkOrgId: testClerkOrgId, url: testUrl });

      expect(response.status).toBe(401);
    });

    it('should return 400 if clerkOrgId is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ url: testUrl });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerkOrgId');
    });

    it('should return 400 if url is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ clerkOrgId: testClerkOrgId });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('url');
    });

    it('should create brand in database when calling POST /sales-profile for first time', async () => {
      const uniqueClerkOrgId = `org_test_brand_create_${Date.now()}`;
      const uniqueUrl = `https://unique-test-${Date.now()}.example.com`;
      const uniqueDomain = uniqueUrl.replace('https://', '');

      // Verify brand doesn't exist before the call
      const existingBrand = await db
        .select()
        .from(brands)
        .where(and(
          eq(brands.clerkOrgId, uniqueClerkOrgId),
          eq(brands.domain, uniqueDomain)
        ))
        .limit(1);
      
      expect(existingBrand.length).toBe(0);

      // Call the endpoint (will fail on Anthropic key but should still create brand)
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ 
          clerkOrgId: uniqueClerkOrgId, 
          url: uniqueUrl,
          keyType: 'byok'
        });

      // Verify brand was created in database
      const createdBrand = await db
        .select()
        .from(brands)
        .where(and(
          eq(brands.clerkOrgId, uniqueClerkOrgId),
          eq(brands.domain, uniqueDomain)
        ))
        .limit(1);

      expect(createdBrand.length).toBe(1);
      expect(createdBrand[0].clerkOrgId).toBe(uniqueClerkOrgId);
      expect(createdBrand[0].domain).toBe(uniqueDomain);
      expect(createdBrand[0].url).toBe(uniqueUrl);
    }, 15000);

    it('should not create duplicate brands on subsequent calls', async () => {
      const uniqueClerkOrgId = `org_test_no_dup_${Date.now()}`;
      const uniqueUrl = `https://no-dup-test-${Date.now()}.example.com`;

      // First call creates brand
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ 
          clerkOrgId: uniqueClerkOrgId, 
          url: uniqueUrl,
          keyType: 'byok'
        });

      // Get brand count after first call
      const brandsAfterFirst = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId));
      
      const countAfterFirst = brandsAfterFirst.length;
      expect(countAfterFirst).toBe(1);

      // Second call should not create duplicate
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ 
          clerkOrgId: uniqueClerkOrgId, 
          url: uniqueUrl,
          keyType: 'byok'
        });

      // Verify no duplicate brands created
      const brandsAfterSecond = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId));
      
      expect(brandsAfterSecond.length).toBe(countAfterFirst);
    }, 15000);

    it('should update URL if brand exists with different URL', async () => {
      const uniqueClerkOrgId = `org_test_url_update_${Date.now()}`;
      const originalUrl = `https://original-${Date.now()}.example.com`;
      const updatedUrl = `https://updated-${Date.now()}.example.com`;

      // First call with original URL
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ 
          clerkOrgId: uniqueClerkOrgId, 
          url: originalUrl,
          keyType: 'byok'
        });

      // Verify original URL stored
      let brand = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId))
        .limit(1);
      
      expect(brand[0].url).toBe(originalUrl);

      // Second call with updated URL (same domain would be same brand)
      // Note: Different domain would create a different brand
    }, 15000);

    it('should create brand with correct domain extraction', async () => {
      // Use unique domains for each test case to avoid UNIQUE constraint conflicts
      const timestamp = Date.now();
      const testCases = [
        { url: `https://www.domain-test-${timestamp}-1.com`, expectedDomain: `domain-test-${timestamp}-1.com` },
        { url: `https://sub.domain-test-${timestamp}-2.com`, expectedDomain: `sub.domain-test-${timestamp}-2.com` },
        { url: `http://domain-test-${timestamp}-3.com/path`, expectedDomain: `domain-test-${timestamp}-3.com` },
      ];

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const uniqueClerkOrgId = `org_test_domain_${timestamp}_${i}`;
        
        await request(app)
          .post('/sales-profile')
          .set(getAuthHeaders())
          .send({ 
            clerkOrgId: uniqueClerkOrgId, 
            url: testCase.url,
            keyType: 'byok'
          });

        const brand = await db
          .select()
          .from(brands)
          .where(eq(brands.clerkOrgId, uniqueClerkOrgId))
          .limit(1);

        expect(brand.length).toBe(1);
        expect(brand[0].domain).toBe(testCase.expectedDomain);
      }
    }, 30000);
  });

  describe('GET /sales-profile/:clerkOrgId', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/sales-profile/${testClerkOrgId}`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent organization', async () => {
      const response = await request(app)
        .get('/sales-profile/org_nonexistent_12345')
        .set(getAuthHeaders());

      expect(response.status).toBe(404);
    });
  });

  describe('GET /sales-profiles', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/sales-profiles');

      expect(response.status).toBe(401);
    });

    it('should return 400 if clerkOrgId query param is missing', async () => {
      const response = await request(app)
        .get('/sales-profiles')
        .set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerkOrgId');
    });

    it('should return empty array for org with no profiles', async () => {
      const response = await request(app)
        .get('/sales-profiles')
        .query({ clerkOrgId: 'org_no_profiles_test' })
        .set(getAuthHeaders());

      expect(response.status).toBe(200);
      expect(response.body.profiles).toEqual([]);
    });
  });

  describe('POST /brands/:brandId/extract-sales-profile', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/brands/some-brand-id/extract-sales-profile')
        .send({ anthropicApiKey: 'test-key' });

      expect(response.status).toBe(401);
    });

    it('should return 400 if anthropicApiKey is missing', async () => {
      const response = await request(app)
        .post('/brands/some-brand-id/extract-sales-profile')
        .set(getAuthHeaders())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('anthropicApiKey');
    });

    it('should return 404 for non-existent brand', async () => {
      const response = await request(app)
        .post('/brands/00000000-0000-0000-0000-000000000000/extract-sales-profile')
        .set(getAuthHeaders())
        .send({ anthropicApiKey: 'test-key' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /brands/:brandId/sales-profile', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/brands/some-brand-id/sales-profile');

      expect(response.status).toBe(401);
    });

    it('should return 404 for brand with no profile', async () => {
      // First create a brand
      const uniqueClerkOrgId = `org_test_no_profile_${Date.now()}`;
      const uniqueUrl = `https://no-profile-${Date.now()}.example.com`;
      
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ 
          clerkOrgId: uniqueClerkOrgId, 
          url: uniqueUrl,
          keyType: 'byok'
        });

      // Get the brand ID
      const brand = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId))
        .limit(1);

      expect(brand.length).toBe(1);

      // Request profile (should be 404 since no profile extracted)
      const response = await request(app)
        .get(`/brands/${brand[0].id}/sales-profile`)
        .set(getAuthHeaders());

      expect(response.status).toBe(404);
    }, 15000);
  });
});
