import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandExtractedFields } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

const app = createTestApp();

const TEST_ORG_ID = '00000000-aaaa-bbbb-cccc-ffffffffffff';
const TEST_BRAND_ID = '00000000-aaaa-bbbb-cccc-000000000001';

describe('GET /brands/:brandId/extracted-fields', () => {
  beforeAll(async () => {
    // Clean up any leftover test data
    await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, TEST_BRAND_ID));
    await db.delete(brands).where(eq(brands.id, TEST_BRAND_ID));

    // Insert test brand
    await db.insert(brands).values({
      id: TEST_BRAND_ID,
      orgId: TEST_ORG_ID,
      url: 'https://example.com',
      domain: 'example.com',
      name: 'Test Brand',
    });

    // Insert some extracted fields
    await db.insert(brandExtractedFields).values([
      {
        brandId: TEST_BRAND_ID,
        fieldKey: 'companyOverview',
        fieldValue: 'A test company that does testing.',
        sourceUrls: ['https://example.com/about'],
        extractedAt: '2026-03-01T00:00:00Z',
        expiresAt: '2026-04-01T00:00:00Z',
      },
      {
        brandId: TEST_BRAND_ID,
        fieldKey: 'targetAudience',
        fieldValue: ['Enterprise developers', 'DevOps teams'],
        sourceUrls: ['https://example.com/solutions'],
        extractedAt: '2026-03-01T00:00:00Z',
        expiresAt: null,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, TEST_BRAND_ID));
    await db.delete(brands).where(eq(brands.id, TEST_BRAND_ID));
  });

  it('should return all extracted fields for a brand', async () => {
    const res = await request(app)
      .get(`/internal/brands/${TEST_BRAND_ID}/extracted-fields`)
      .set(getAuthHeaders(TEST_ORG_ID));

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe(TEST_BRAND_ID);
    expect(res.body.fields).toHaveLength(2);

    const overview = res.body.fields.find((f: any) => f.key === 'companyOverview');
    expect(overview).toBeDefined();
    expect(overview.value).toBe('A test company that does testing.');
    expect(overview.sourceUrls).toEqual(['https://example.com/about']);
    expect(overview.extractedAt).toBeDefined();
    expect(overview.expiresAt).toBeDefined();

    const audience = res.body.fields.find((f: any) => f.key === 'targetAudience');
    expect(audience).toBeDefined();
    expect(audience.value).toEqual(['Enterprise developers', 'DevOps teams']);
    expect(audience.expiresAt).toBeNull();
  });

  it('should return empty fields array for brand with no extractions', async () => {
    // Create a brand with no extracted fields
    const emptyBrandId = '00000000-aaaa-bbbb-cccc-000000000002';
    await db.delete(brands).where(eq(brands.id, emptyBrandId));
    await db.insert(brands).values({
      id: emptyBrandId,
      orgId: TEST_ORG_ID,
      url: 'https://empty.com',
      domain: 'empty.com',
      name: 'Empty Brand',
    });

    try {
      const res = await request(app)
        .get(`/internal/brands/${emptyBrandId}/extracted-fields`)
        .set(getAuthHeaders(TEST_ORG_ID));

      expect(res.status).toBe(200);
      expect(res.body.brandId).toBe(emptyBrandId);
      expect(res.body.fields).toEqual([]);
    } finally {
      await db.delete(brands).where(eq(brands.id, emptyBrandId));
    }
  });

  it('should return 400 for non-UUID brandId', async () => {
    const res = await request(app)
      .get('/internal/brands/not-a-uuid/extracted-fields')
      .set(getAuthHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should return 404 for non-existent brand', async () => {
    const res = await request(app)
      .get('/internal/brands/00000000-0000-0000-0000-000000000099/extracted-fields')
      .set(getAuthHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .get(`/internal/brands/${TEST_BRAND_ID}/extracted-fields`);

    expect(res.status).toBe(401);
  });
});
