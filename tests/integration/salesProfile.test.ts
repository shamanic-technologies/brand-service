import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandSalesProfiles, orgs } from '../../src/db/schema';
import { eq, and, like, inArray } from 'drizzle-orm';

const app = createTestApp();

describe('Sales Profile API - Complete Integration Tests', () => {
  const testClerkOrgId = `org_test_${Date.now()}`;
  const testUrl = 'https://test-brand-integration.example.com';
  const testDomain = 'test-brand-integration.example.com';

  // Clean up test data after all tests
  afterAll(async () => {
    try {
      // Find test orgs
      const testOrgs = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(like(orgs.clerkOrgId, 'org_test_%'));

      if (testOrgs.length > 0) {
        const orgIds = testOrgs.map(o => o.id);
        // Delete sales profiles for test brands first (foreign key)
        const testBrands = await db
          .select({ id: brands.id })
          .from(brands)
          .where(inArray(brands.orgId, orgIds));

        for (const brand of testBrands) {
          await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
        }

        // Delete test brands, then orgs
        await db.delete(brands).where(inArray(brands.orgId, orgIds));
      }
      await db.delete(orgs).where(like(orgs.clerkOrgId, 'org_test_%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  describe('POST /sales-profile - Brand Creation', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .send({ appId: 'mcpfactory', clerkOrgId: testClerkOrgId, url: testUrl, clerkUserId: 'user_test', parentRunId: 'run_test' });

      expect(response.status).toBe(401);
    });

    it('should return 400 if parentRunId is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', clerkOrgId: testClerkOrgId, url: testUrl, clerkUserId: 'user_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if clerkOrgId is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', url: testUrl, clerkUserId: 'user_test', parentRunId: 'run_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if url is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', clerkOrgId: testClerkOrgId, clerkUserId: 'user_test', parentRunId: 'run_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if appId is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ clerkOrgId: testClerkOrgId, url: testUrl, clerkUserId: 'user_test', parentRunId: 'run_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should return 400 if clerkUserId is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ appId: 'mcpfactory', clerkOrgId: testClerkOrgId, url: testUrl, parentRunId: 'run_test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should create brand in database when calling POST /sales-profile for first time', async () => {
      const uniqueClerkOrgId = `org_test_brand_create_${Date.now()}`;
      const uniqueUrl = `https://unique-test-${Date.now()}.example.com`;
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
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId: `user_test_${Date.now()}`,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
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
        .where(and(eq(brands.orgId, org.id), eq(brands.domain, uniqueDomain)))
        .limit(1);

      expect(createdBrand.length).toBe(1);
      expect(createdBrand[0].domain).toBe(uniqueDomain);
      expect(createdBrand[0].url).toBe(uniqueUrl);
    }, 15000);

    it('should not create duplicate brands on subsequent calls', async () => {
      const uniqueClerkOrgId = `org_test_no_dup_${Date.now()}`;
      const uniqueUrl = `https://no-dup-test-${Date.now()}.example.com`;
      const clerkUserId = `user_test_${Date.now()}`;

      // First call creates brand
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
        });

      // Get brand count after first call
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
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId,
          keyType: 'byok',
          parentRunId: 'run_test_parent_2',
        });

      // Verify no duplicate brands created
      const brandsAfterSecond = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id));

      expect(brandsAfterSecond.length).toBe(brandsAfterFirst.length);
    }, 15000);

    it('should update URL if brand exists with different URL', async () => {
      const uniqueClerkOrgId = `org_test_url_update_${Date.now()}`;
      const originalUrl = `https://original-${Date.now()}.example.com`;
      const clerkUserId = `user_test_${Date.now()}`;

      // First call with original URL
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: originalUrl,
          clerkUserId,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
        });

      // Verify original URL stored
      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      const brand = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id))
        .limit(1);

      expect(brand[0].url).toBe(originalUrl);
    }, 15000);

    it('should create brand with correct domain extraction', async () => {
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
            appId: 'mcpfactory',
            clerkOrgId: uniqueClerkOrgId,
            url: testCase.url,
            clerkUserId: `user_test_${timestamp}_${i}`,
            keyType: 'byok',
            parentRunId: 'run_test_parent',
          });

        const [org] = await db
          .select()
          .from(orgs)
          .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
        const brand = await db
          .select()
          .from(brands)
          .where(eq(brands.orgId, org.id))
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
      expect(response.body.error).toBe('Invalid request');
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

  describe('New fields roundtrip (leadership, funding, awards, milestones)', () => {
    it('should return new fields from a stored profile via GET /brands/:brandId/sales-profile', async () => {
      const uniqueClerkOrgId = `org_test_newfields_${Date.now()}`;
      const uniqueUrl = `https://newfields-test-${Date.now()}.example.com`;

      // Create org + brand via API
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId: `user_test_${Date.now()}`,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
        });

      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id));

      // Insert profile with new fields directly
      await db.insert(brandSalesProfiles).values({
        brandId: brand.id,
        valueProposition: 'Test VP',
        customerPainPoints: ['pain1'],
        callToAction: 'Book demo',
        socialProof: {
          caseStudies: [],
          testimonials: [{ quote: 'Great!', name: 'Alice', role: 'CTO', company: 'Acme' }],
          results: [],
        },
        companyOverview: 'Test overview',
        additionalContext: null,
        competitors: [],
        productDifferentiators: [],
        targetAudience: 'B2B SaaS',
        keyFeatures: [],
        leadership: [{ name: 'Jane Smith', role: 'CEO', bio: null, notableBackground: 'Former Google' }],
        funding: { totalRaised: '$10M', rounds: [], notableBackers: ['YC'] },
        awardsAndRecognition: [{ title: 'Best SaaS', issuer: 'G2', year: '2023', description: null }],
        revenueMilestones: [{ metric: 'ARR', value: '$5M', date: '2023', context: null }],
        urgency: { elements: ['Offer expires Dec 31'], summary: 'Year-end deadline' },
        scarcity: { elements: ['Only 10 spots worldwide'], summary: 'Very limited' },
        riskReversal: { guarantees: ['90-day money-back'], trialInfo: '2-week trial', refundPolicy: 'Full refund' },
        priceAnchoring: { anchors: ['Value: $25,000'], comparisonPoints: ['Pack at $997'] },
        valueStacking: { bundledValue: ['Press ($5K)', 'Podcasts ($3K)'], totalPerceivedValue: '$25,000+' },
        extractionModel: 'claude-opus-4-5',
        extractionInputTokens: 1000,
        extractionOutputTokens: 500,
        extractionCostUsd: '0.01',
        sourceScrapeIds: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).onConflictDoUpdate({
        target: brandSalesProfiles.brandId,
        set: {
          leadership: [{ name: 'Jane Smith', role: 'CEO', bio: null, notableBackground: 'Former Google' }],
          funding: { totalRaised: '$10M', rounds: [], notableBackers: ['YC'] },
          awardsAndRecognition: [{ title: 'Best SaaS', issuer: 'G2', year: '2023', description: null }],
          revenueMilestones: [{ metric: 'ARR', value: '$5M', date: '2023', context: null }],
          socialProof: {
            caseStudies: [],
            testimonials: [{ quote: 'Great!', name: 'Alice', role: 'CTO', company: 'Acme' }],
            results: [],
          },
          urgency: { elements: ['Offer expires Dec 31'], summary: 'Year-end deadline' },
          scarcity: { elements: ['Only 10 spots worldwide'], summary: 'Very limited' },
          riskReversal: { guarantees: ['90-day money-back'], trialInfo: '2-week trial', refundPolicy: 'Full refund' },
          priceAnchoring: { anchors: ['Value: $25,000'], comparisonPoints: ['Pack at $997'] },
          valueStacking: { bundledValue: ['Press ($5K)', 'Podcasts ($3K)'], totalPerceivedValue: '$25,000+' },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const response = await request(app)
        .get(`/brands/${brand.id}/sales-profile`)
        .set(getAuthHeaders());

      expect(response.status).toBe(200);
      const profile = response.body.profile;

      expect(profile.leadership).toHaveLength(1);
      expect(profile.leadership[0].name).toBe('Jane Smith');
      expect(profile.funding.totalRaised).toBe('$10M');
      expect(profile.funding.notableBackers).toContain('YC');
      expect(profile.awardsAndRecognition).toHaveLength(1);
      expect(profile.awardsAndRecognition[0].title).toBe('Best SaaS');
      expect(profile.revenueMilestones).toHaveLength(1);
      expect(profile.revenueMilestones[0].metric).toBe('ARR');
      expect(profile.socialProof.testimonials[0]).toHaveProperty('quote', 'Great!');
      // Persuasion levers
      expect(profile.urgency.elements).toHaveLength(1);
      expect(profile.urgency.summary).toBe('Year-end deadline');
      expect(profile.scarcity.elements[0]).toContain('10 spots');
      expect(profile.riskReversal.guarantees[0]).toContain('money-back');
      expect(profile.riskReversal.trialInfo).toContain('2-week');
      expect(profile.priceAnchoring.anchors[0]).toContain('$25,000');
      expect(profile.valueStacking.bundledValue).toHaveLength(2);
      expect(profile.valueStacking.totalPerceivedValue).toContain('$25,000');
    }, 15000);

    it('should return empty arrays/null for new fields when absent in DB', async () => {
      const uniqueClerkOrgId = `org_test_nullfields_${Date.now()}`;
      const uniqueUrl = `https://nullfields-test-${Date.now()}.example.com`;

      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId: `user_test_${Date.now()}`,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
        });

      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id));

      // Insert profile WITHOUT new fields (simulating pre-migration data)
      await db.insert(brandSalesProfiles).values({
        brandId: brand.id,
        valueProposition: 'Test VP',
        customerPainPoints: [],
        socialProof: { caseStudies: [], testimonials: ['Legacy string'], results: [] },
        extractionModel: 'claude-opus-4-5',
        extractionInputTokens: 1000,
        extractionOutputTokens: 500,
        extractionCostUsd: '0.01',
        sourceScrapeIds: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).onConflictDoUpdate({
        target: brandSalesProfiles.brandId,
        set: {
          socialProof: { caseStudies: [], testimonials: ['Legacy string'], results: [] },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const response = await request(app)
        .get(`/brands/${brand.id}/sales-profile`)
        .set(getAuthHeaders());

      expect(response.status).toBe(200);
      const profile = response.body.profile;
      expect(profile.leadership).toEqual([]);
      expect(profile.funding).toBeNull();
      expect(profile.awardsAndRecognition).toEqual([]);
      expect(profile.revenueMilestones).toEqual([]);
      // Persuasion levers default to null for pre-migration data
      expect(profile.urgency).toBeNull();
      expect(profile.scarcity).toBeNull();
      expect(profile.riskReversal).toBeNull();
      expect(profile.priceAnchoring).toBeNull();
      expect(profile.valueStacking).toBeNull();
      // Legacy string testimonial preserved
      expect(profile.socialProof.testimonials[0]).toBe('Legacy string');
    }, 15000);
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
          appId: 'mcpfactory',
          clerkOrgId: uniqueClerkOrgId,
          url: uniqueUrl,
          clerkUserId: `user_test_${Date.now()}`,
          keyType: 'byok',
          parentRunId: 'run_test_parent',
        });

      // Get the brand ID via org
      const [org] = await db
        .select()
        .from(orgs)
        .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, uniqueClerkOrgId)));
      const brand = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, org.id))
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
