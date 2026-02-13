import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandIcpSuggestionsForApollo, orgs } from '../../src/db/schema';
import { eq, like, and, inArray } from 'drizzle-orm';

const app = createTestApp();

describe('ICP Suggestion API', () => {
  // Clean up test data after all tests
  afterAll(async () => {
    try {
      const testOrgs = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(like(orgs.clerkOrgId, 'org_test_icp_%'));

      if (testOrgs.length > 0) {
        const orgIds = testOrgs.map(o => o.id);
        const testBrands = await db
          .select({ id: brands.id })
          .from(brands)
          .where(inArray(brands.orgId, orgIds));

        for (const brand of testBrands) {
          await db.delete(brandIcpSuggestionsForApollo).where(eq(brandIcpSuggestionsForApollo.brandId, brand.id));
        }

        await db.delete(brands).where(inArray(brands.orgId, orgIds));
      }

      await db.delete(orgs).where(like(orgs.clerkOrgId, 'org_test_icp_%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  describe('POST /icp-suggestion', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .send({ appId: 'mcpfactory', clerkOrgId: 'org_test_icp_noauth', url: 'https://example.com', clerkUserId: 'user_test' });

      expect(response.status).toBe(401);
    });

    it('should return 400 if clerkOrgId is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', url: 'https://example.com', clerkUserId: 'user_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if url is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', clerkOrgId: 'org_test_icp_nourl', clerkUserId: 'user_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if appId is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ clerkOrgId: 'org_test_icp_noapp', url: 'https://example.com', clerkUserId: 'user_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if clerkUserId is missing', async () => {
      const response = await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', clerkOrgId: 'org_test_icp_nouser', url: 'https://example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should create brand in database when calling POST /icp-suggestion for first time', async () => {
      const uniqueClerkOrgId = `org_test_icp_create_${Date.now()}`;
      const uniqueUrl = `https://icp-test-${Date.now()}.example.com`;
      const uniqueDomain = uniqueUrl.replace('https://', '');

      // Verify no org exists before the call
      const existingOrg = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)))
        .limit(1);

      expect(existingOrg.length).toBe(0);

      // Call the endpoint (will fail on Anthropic key but should still create brand)
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId: `user_test_icp_${Date.now()}`,
          keyType: 'byok',
        });

      // Verify org and brand were created in database
      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      expect(org).toBeDefined();

      const createdBrand = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id))
        .limit(1);

      expect(createdBrand.length).toBe(1);
      expect(createdBrand[0].domain).toBe(uniqueDomain);
      expect(createdBrand[0].url).toBe(uniqueUrl);
    }, 15000);

    it('should not create duplicate brands on subsequent calls', async () => {
      const uniqueClerkOrgId = `org_test_icp_nodup_${Date.now()}`;
      const uniqueUrl = `https://icp-nodup-${Date.now()}.example.com`;
      const clerkUserId = `user_test_icp_nodup_${Date.now()}`;

      // First call creates brand
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId,
          keyType: 'byok',
        });

      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      const brandsAfterFirst = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id));

      expect(brandsAfterFirst.length).toBe(1);

      // Second call should not create duplicate
      await request(app)
        .post('/icp-suggestion')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId,
          keyType: 'byok',
        });

      const brandsAfterSecond = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id));

      expect(brandsAfterSecond.length).toBe(1);
    }, 15000);
  });
});
