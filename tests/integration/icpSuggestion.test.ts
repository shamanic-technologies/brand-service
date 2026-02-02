import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandIcpSuggestionsForApollo } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('ICP Suggestion API', () => {
  // Clean up test data after all tests
  afterAll(async () => {
    try {
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.clerkOrgId, 'org_test_icp_%'));

      for (const brand of testBrands) {
        await db.delete(brandIcpSuggestionsForApollo).where(eq(brandIcpSuggestionsForApollo.brandId, brand.id));
      }

      await db.delete(brands).where(like(brands.clerkOrgId, 'org_test_icp_%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  describe('POST /icp-suggestion', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .send({ clerkOrgId: 'org_test_icp_noauth', url: 'https://example.com' });

      expect(response.status).toBe(401);
    });

    it('should return 400 if clerkOrgId is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerkOrgId');
    });

    it('should return 400 if url is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ clerkOrgId: 'org_test_icp_nourl' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('url');
    });

    it('should create brand in database when calling POST /icp-suggestion for first time', async () => {
      const uniqueClerkOrgId = `org_test_icp_create_${Date.now()}`;
      const uniqueUrl = `https://icp-test-${Date.now()}.example.com`;
      const uniqueDomain = uniqueUrl.replace('https://', '');

      // Verify brand doesn't exist before the call
      const existingBrand = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId))
        .limit(1);

      expect(existingBrand.length).toBe(0);

      // Call the endpoint (will fail on Anthropic key but should still create brand)
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          keyType: 'byok',
        });

      // Verify brand was created in database
      const createdBrand = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId))
        .limit(1);

      expect(createdBrand.length).toBe(1);
      expect(createdBrand[0].clerkOrgId).toBe(uniqueClerkOrgId);
      expect(createdBrand[0].domain).toBe(uniqueDomain);
      expect(createdBrand[0].url).toBe(uniqueUrl);
    }, 15000);

    it('should not create duplicate brands on subsequent calls', async () => {
      const uniqueClerkOrgId = `org_test_icp_nodup_${Date.now()}`;
      const uniqueUrl = `https://icp-nodup-${Date.now()}.example.com`;

      // First call creates brand
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          keyType: 'byok',
        });

      const brandsAfterFirst = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId));

      expect(brandsAfterFirst.length).toBe(1);

      // Second call should not create duplicate
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          keyType: 'byok',
        });

      const brandsAfterSecond = await db
        .select()
        .from(brands)
        .where(eq(brands.clerkOrgId, uniqueClerkOrgId));

      expect(brandsAfterSecond.length).toBe(1);
    }, 15000);
  });
});
