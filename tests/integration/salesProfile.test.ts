import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandSalesProfiles } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';
import { SiteMapError } from '../../src/services/salesProfileExtractionService';

const app = createTestApp();

describe('Sales Profile API — Refactored Endpoints', () => {
  // Clean up test data after all tests
  afterAll(async () => {
    try {
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.orgId, 'test-%'));

      for (const brand of testBrands) {
        await db.delete(brandSalesProfiles).where(eq(brandSalesProfiles.brandId, brand.id));
      }

      await db.delete(brands).where(like(brands.orgId, 'test-%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  /**
   * Helper: create a brand and optionally insert a cached profile
   */
  async function createBrandWithProfile(opts: { withProfile: boolean } = { withProfile: false }) {
    const ts = Date.now();
    const orgId = `test-sp-${ts}`;
    const userId = `test-user-${ts}`;
    const url = `https://sp-test-${ts}.example.com`;

    // Create brand via POST /brands
    const brandRes = await request(app)
      .post('/brands')
      .set(getAuthHeaders(orgId, userId))
      .send({ url });

    expect(brandRes.status).toBe(200);
    const brandId = brandRes.body.brandId;

    if (opts.withProfile) {
      await db.insert(brandSalesProfiles).values({
        brandId,
        valueProposition: 'Test VP',
        customerPainPoints: ['pain1'],
        callToAction: 'Book demo',
        socialProof: { caseStudies: [], testimonials: [], results: [] },
        companyOverview: 'Test overview',
        additionalContext: null,
        competitors: [],
        productDifferentiators: [],
        targetAudience: 'B2B SaaS',
        keyFeatures: [],
        leadership: [{ name: 'Jane', role: 'CEO', bio: null, notableBackground: null }],
        funding: null,
        awardsAndRecognition: [],
        revenueMilestones: [],
        urgency: null,
        scarcity: null,
        riskReversal: null,
        priceAnchoring: null,
        valueStacking: null,
        extractionModel: 'claude-sonnet-4-6',
        sourceScrapeIds: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).onConflictDoUpdate({
        target: brandSalesProfiles.brandId,
        set: {
          valueProposition: 'Test VP',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
    }

    return { orgId, userId, brandId };
  }

  // ──────────────────────────────────────────────
  // GET /brands/:brandId/sales-profile
  // ──────────────────────────────────────────────

  describe('GET /brands/:brandId/sales-profile', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/brands/some-id/sales-profile');
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid brandId format', async () => {
      const res = await request(app)
        .get('/brands/not-a-uuid/sales-profile')
        .set(getAuthHeaders());

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid brandId');
    });

    it('should return 404 when no profile exists', async () => {
      const { brandId } = await createBrandWithProfile({ withProfile: false });

      const res = await request(app)
        .get(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders());

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Sales profile not found');
    });

    it('should return 404 for non-existent brandId', async () => {
      const res = await request(app)
        .get('/brands/00000000-0000-0000-0000-000000000000/sales-profile')
        .set(getAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('should return profile when it exists', async () => {
      const { brandId } = await createBrandWithProfile({ withProfile: true });

      const res = await request(app)
        .get(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.brandId).toBe(brandId);
      expect(res.body.profile.valueProposition).toBe('Test VP');
      expect(res.body.profile.leadership).toHaveLength(1);
      // Should NOT include internal IDs
      expect(res.body.profile.id).toBeUndefined();
      expect(res.body.profile.brandId).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────
  // POST /brands/:brandId/sales-profile
  // ──────────────────────────────────────────────

  describe('POST /brands/:brandId/sales-profile', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/brands/some-id/sales-profile').send({});
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid brandId format', async () => {
      const res = await request(app)
        .post('/brands/not-a-uuid/sales-profile')
        .set(getAuthHeaders())
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid brandId');
    });

    it('should return 404 for non-existent brand', async () => {
      const res = await request(app)
        .post('/brands/00000000-0000-0000-0000-000000000000/sales-profile')
        .set(getAuthHeaders())
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Brand not found');
    });

    it('should return 409 when profile already exists', async () => {
      const { brandId } = await createBrandWithProfile({ withProfile: true });

      const res = await request(app)
        .post(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders())
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Sales profile already exists');
    });

    it('should accept user hint fields', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: false });

      const res = await request(app)
        .post(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({
          urgency: 'Offer expires March 1st',
          scarcity: 'Only 10 spots left',
          riskReversal: '30-day money-back guarantee',
          socialProof: 'Trusted by 500+ companies',
        });

      // Should not be a 400 (validation passed)
      expect(res.status).not.toBe(400);
      // In test env without key-service, expect 502 or 500
      expect([500, 502]).toContain(res.status);
    }, 15000);

    it('should attempt extraction when no profile exists (fails on key-service in test env)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: false });

      const res = await request(app)
        .post(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({});

      // In test env without key-service, expect 502 or 500
      expect([500, 502]).toContain(res.status);
    }, 15000);

    it('should return 422 when site mapping fails (SiteMapError)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: false });

      // Mock extractBrandSalesProfile to throw SiteMapError (simulates scraping-service 400)
      const service = await import('../../src/services/salesProfileExtractionService');
      const spy = vi.spyOn(service, 'extractBrandSalesProfile').mockRejectedValueOnce(
        new SiteMapError('Could not map site URLs: Invalid URL or site unreachable')
      );

      // Also mock getKeyForOrg so we don't hit key-service
      const keysLib = await import('../../src/lib/keys-service');
      const keySpy = vi.spyOn(keysLib, 'getKeyForOrg').mockResolvedValueOnce({
        key: 'fake-key',
        keySource: 'platform',
      });

      const res = await request(app)
        .post(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error).toContain('Could not map site URLs');

      spy.mockRestore();
      keySpy.mockRestore();
    }, 15000);
  });

  // ──────────────────────────────────────────────
  // PUT /brands/:brandId/sales-profile
  // ──────────────────────────────────────────────

  describe('PUT /brands/:brandId/sales-profile', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).put('/brands/some-id/sales-profile').send({});
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid brandId format', async () => {
      const res = await request(app)
        .put('/brands/not-a-uuid/sales-profile')
        .set(getAuthHeaders())
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid brandId');
    });

    it('should return 404 for non-existent brand', async () => {
      const res = await request(app)
        .put('/brands/00000000-0000-0000-0000-000000000000/sales-profile')
        .set(getAuthHeaders())
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Brand not found');
    });

    it('should return cached profile when one exists (no ?force)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: true });

      const res = await request(app)
        .put(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.profile.valueProposition).toBe('Test VP');
    }, 15000);

    it('should return cached profile even when user hints are provided (no ?force)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: true });

      const res = await request(app)
        .put(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({
          urgency: 'Limited time offer',
          socialProof: 'Used by Fortune 500',
        });

      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
    }, 15000);

    it('should force re-extraction with ?force=true (fails on key-service in test env)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: true });

      const res = await request(app)
        .put(`/brands/${brandId}/sales-profile?force=true`)
        .set(getAuthHeaders(orgId, userId))
        .send({});

      // With ?force=true, it attempts re-extraction which fails on key-service in test env
      expect([500, 502]).toContain(res.status);
    }, 15000);

    it('should attempt extraction when no profile exists (fails on key-service in test env)', async () => {
      const { brandId, orgId, userId } = await createBrandWithProfile({ withProfile: false });

      const res = await request(app)
        .put(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders(orgId, userId))
        .send({});

      // No cached profile, so it attempts extraction which fails on key-service
      expect([500, 502]).toContain(res.status);
    }, 15000);
  });

  // ──────────────────────────────────────────────
  // Old endpoints should be gone (404)
  // ──────────────────────────────────────────────

  describe('Removed endpoints return 404', () => {
    it('POST /sales-profile should return 404', async () => {
      const res = await request(app)
        .post('/sales-profile')
        .set(getAuthHeaders())
        .send({ url: 'https://example.com' });

      expect(res.status).toBe(404);
    });

    it('GET /sales-profiles should return 404', async () => {
      const res = await request(app)
        .get('/sales-profiles')
        .set(getAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('GET /sales-profile/:orgId should return 404', async () => {
      const res = await request(app)
        .get('/sales-profile/some-org-id')
        .set(getAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────
  // Profile field roundtrip
  // ──────────────────────────────────────────────

  describe('Profile field roundtrip', () => {
    it('should return all profile fields including persuasion levers', async () => {
      const { brandId } = await createBrandWithProfile({ withProfile: false });

      // Insert profile with all fields
      await db.insert(brandSalesProfiles).values({
        brandId,
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
          valueProposition: 'Test VP',
          leadership: [{ name: 'Jane Smith', role: 'CEO', bio: null, notableBackground: 'Former Google' }],
          funding: { totalRaised: '$10M', rounds: [], notableBackers: ['YC'] },
          urgency: { elements: ['Offer expires Dec 31'], summary: 'Year-end deadline' },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const res = await request(app)
        .get(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders());

      expect(res.status).toBe(200);
      const profile = res.body.profile;

      expect(profile.valueProposition).toBe('Test VP');
      expect(profile.leadership).toHaveLength(1);
      expect(profile.leadership[0].name).toBe('Jane Smith');
      expect(profile.funding.totalRaised).toBe('$10M');
      expect(profile.awardsAndRecognition).toHaveLength(1);
      expect(profile.revenueMilestones).toHaveLength(1);
      expect(profile.urgency.summary).toBe('Year-end deadline');
      expect(profile.scarcity.elements[0]).toContain('10 spots');
      expect(profile.riskReversal.guarantees[0]).toContain('money-back');
      expect(profile.priceAnchoring.anchors[0]).toContain('$25,000');
      expect(profile.valueStacking.bundledValue).toHaveLength(2);
    }, 15000);

    it('should return defaults for missing fields (pre-migration data)', async () => {
      const { brandId } = await createBrandWithProfile({ withProfile: false });

      await db.insert(brandSalesProfiles).values({
        brandId,
        valueProposition: 'Legacy VP',
        customerPainPoints: [],
        socialProof: { caseStudies: [], testimonials: ['Legacy string'], results: [] },
        extractionModel: 'claude-sonnet-4-6',
        sourceScrapeIds: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }).onConflictDoUpdate({
        target: brandSalesProfiles.brandId,
        set: {
          valueProposition: 'Legacy VP',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const res = await request(app)
        .get(`/brands/${brandId}/sales-profile`)
        .set(getAuthHeaders());

      expect(res.status).toBe(200);
      const profile = res.body.profile;
      expect(profile.leadership).toEqual([]);
      expect(profile.funding).toBeNull();
      expect(profile.awardsAndRecognition).toEqual([]);
      expect(profile.urgency).toBeNull();
      expect(profile.scarcity).toBeNull();
      expect(profile.riskReversal).toBeNull();
      expect(profile.priceAnchoring).toBeNull();
      expect(profile.valueStacking).toBeNull();
      expect(profile.socialProof.testimonials[0]).toBe('Legacy string');
    }, 15000);
  });
});
