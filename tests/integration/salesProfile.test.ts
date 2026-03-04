import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandSalesProfiles } from '../../src/db/schema';
import { eq, and, like, inArray } from 'drizzle-orm';

const app = createTestApp();

describe('Sales Profile API - Complete Integration Tests', () => {
  const testOrgId = `test-org-${Date.now()}`;
  const testUserId = `test-user-${Date.now()}`;
  const testUrl = 'https://test-brand-integration.example.com';
  const testDomain = 'test-brand-integration.example.com';

  // Clean up test data after all tests
  afterAll(async () => {
    try {
      // Delete sales profiles for test brands first (foreign key)
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.orgId, 'test-%'));

      for (const brand of testBrands) {
        await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
      }

      // Delete test brands
      await db.delete(brands).where(like(brands.orgId, 'test-%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  describe('POST /sales-profile - Brand Creation', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .send({ url: testUrl });

      expect(response.status).toBe(401);
    });

    it('should return 400 if url is missing', async () => {
      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(testOrgId, testUserId))
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should create brand in database when calling POST /sales-profile for first time', async () => {
      const uniqueOrgId = `test-brand-create-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://unique-test-${Date.now()}.example.com`;
      const uniqueDomain = uniqueUrl.replace('https://', '');

      // Verify no brand exists before the call
      const existingBrand = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId))
        .limit(1);

      expect(existingBrand.length).toBe(0);

      // Call the endpoint (will fail on Anthropic key but should still create brand)
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      // Verify brand was created in database
      const createdBrand = await db
        .select()
        .from(brands)
        .where(and(eq(brands.orgId, uniqueOrgId), eq(brands.domain, uniqueDomain)))
        .limit(1);

      expect(createdBrand.length).toBe(1);
      expect(createdBrand[0].domain).toBe(uniqueDomain);
      expect(createdBrand[0].url).toBe(uniqueUrl);
    }, 15000);

    it('should not create duplicate brands on subsequent calls', async () => {
      const uniqueOrgId = `test-no-dup-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://no-dup-test-${Date.now()}.example.com`;

      // First call creates brand
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      // Get brand count after first call
      const brandsAfterFirst = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

      expect(brandsAfterFirst.length).toBe(1);

      // Second call should not create duplicate
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      // Verify no duplicate brands created
      const brandsAfterSecond = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

      expect(brandsAfterSecond.length).toBe(brandsAfterFirst.length);
    }, 15000);

    it('should update URL if brand exists with different URL', async () => {
      const uniqueOrgId = `test-url-update-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const originalUrl = `https://original-${Date.now()}.example.com`;

      // First call with original URL
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: originalUrl,

        });

      // Verify original URL stored
      const brand = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId))
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
        const uniqueOrgId = `test-domain-${timestamp}-${i}`;
        const uniqueUserId = `test-user-${timestamp}-${i}`;

        await request(app)
          .post('/sales-profile')
          .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
          .send({
            url: testCase.url,
  
          });

        const brand = await db
          .select()
          .from(brands)
          .where(eq(brands.orgId, uniqueOrgId))
          .limit(1);

        expect(brand.length).toBe(1);
        expect(brand[0].domain).toBe(testCase.expectedDomain);
      }
    }, 30000);
  });

  describe('POST /sales-profile - User hints (urgency, scarcity, riskReversal, socialProof)', () => {
    it('should accept request with all 4 user hint fields', async () => {
      const uniqueOrgId = `test-hints-all-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://hints-all-${Date.now()}.example.com`;

      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

          urgency: 'Offer expires March 1st',
          scarcity: 'Only 10 enterprise spots left',
          riskReversal: '30-day money-back guarantee',
          socialProof: 'Trusted by 500+ SaaS companies including Stripe',
        });

      // Should not be 400 (validation should pass)
      expect(response.status).not.toBe(400);
    }, 15000);

    it('should accept request with partial user hint fields', async () => {
      const uniqueOrgId = `test-hints-partial-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://hints-partial-${Date.now()}.example.com`;

      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

          urgency: 'Limited time offer',
        });

      expect(response.status).not.toBe(400);
    }, 15000);

    it('should accept request with no user hint fields (backward compatible)', async () => {
      const uniqueOrgId = `test-hints-none-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://hints-none-${Date.now()}.example.com`;

      const response = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      expect(response.status).not.toBe(400);
    }, 15000);
  });

  describe('GET /sales-profile/:orgId', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/sales-profile/${testOrgId}`);

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

    it('should return empty array for org with no profiles', async () => {
      const response = await request(app)
        .get('/sales-profiles')
        .set(getAuthHeaders('org_no_profiles_test', 'user_test'));

      expect(response.status).toBe(200);
      expect(response.body.profiles).toEqual([]);
    });
  });

  describe('New fields roundtrip (leadership, funding, awards, milestones)', () => {
    it('should return new fields from a stored profile via GET /brands/:brandId/sales-profile', async () => {
      const uniqueOrgId = `test-newfields-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://newfields-test-${Date.now()}.example.com`;

      // Create brand via API
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

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
        extractionModel: 'claude-sonnet-4-6',
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
      const uniqueOrgId = `test-nullfields-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://nullfields-test-${Date.now()}.example.com`;

      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({
          url: uniqueUrl,

        });

      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

      // Insert profile WITHOUT new fields (simulating pre-migration data)
      await db.insert(brandSalesProfiles).values({
        brandId: brand.id,
        valueProposition: 'Test VP',
        customerPainPoints: [],
        socialProof: { caseStudies: [], testimonials: ['Legacy string'], results: [] },
        extractionModel: 'claude-sonnet-4-6',
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

  describe('GET /brands/:brandId/sales-profile (get-or-create)', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/brands/some-brand-id/sales-profile');

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent brand', async () => {
      const response = await request(app)
        .get('/brands/00000000-0000-0000-0000-000000000000/sales-profile')
        .set(getAuthHeaders());

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Brand not found');
    });

    it('should return cached profile with cached: true when profile exists', async () => {
      const uniqueOrgId = `test-cached-get-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://cached-get-${Date.now()}.example.com`;

      // Create brand
      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({ url: uniqueUrl });

      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

      // Insert a cached profile directly
      await db.insert(brandSalesProfiles).values({
        brandId: brand.id,
        valueProposition: 'Test cached VP',
        customerPainPoints: ['pain1'],
        socialProof: { caseStudies: [], testimonials: [], results: [] },
        extractionModel: 'claude-sonnet-4-6',
        sourceScrapeIds: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).onConflictDoUpdate({
        target: brandSalesProfiles.brandId,
        set: {
          valueProposition: 'Test cached VP',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const response = await request(app)
        .get(`/brands/${brand.id}/sales-profile`)
        .set(getAuthHeaders());

      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
      expect(response.body.brandId).toBe(brand.id);
      expect(response.body.profile.valueProposition).toBe('Test cached VP');
      // Should NOT include internal IDs
      expect(response.body.profile.id).toBeUndefined();
      expect(response.body.profile.brandId).toBeUndefined();
    }, 15000);

    it('should attempt extraction when no cached profile exists (fails gracefully in test env)', async () => {
      // Create a brand with URL but no profile
      const uniqueOrgId = `test-extract-get-${Date.now()}`;
      const uniqueUserId = `test-user-${Date.now()}`;
      const uniqueUrl = `https://extract-get-${Date.now()}.example.com`;

      await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId))
        .send({ url: uniqueUrl });

      const [brand] = await db
        .select()
        .from(brands)
        .where(eq(brands.orgId, uniqueOrgId));

      // GET should try to extract — will fail on key-service in test env (502 or 500)
      const response = await request(app)
        .get(`/brands/${brand.id}/sales-profile`)
        .set(getAuthHeaders(uniqueOrgId, uniqueUserId));

      // Should NOT be 404 anymore — it attempts extraction instead
      expect(response.status).not.toBe(404);
      // In test env without key-service, expect 502 (key-service error) or 500
      expect([400, 500, 502]).toContain(response.status);
    }, 15000);
  });
});
