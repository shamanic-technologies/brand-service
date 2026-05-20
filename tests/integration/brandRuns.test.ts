import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

// Mock runs-client to avoid calling real runs-service in tests
vi.mock('../../src/lib/runs-client', () => ({
  listRuns: vi.fn().mockResolvedValue({ runs: [], limit: 50, offset: 0 }),
}));

const app = createTestApp();

describe('GET /brands/:id/runs - Integration Tests', () => {
  let testBrandId: string;
  const testOrgId = randomUUID();

  beforeAll(async () => {
    // Silver brand + org_brands membership for the test org.
    const ts = Date.now();
    const [brand] = await db
      .insert(brands)
      .values({
        url: `https://runs-test-${ts}.example.com`,
        domain: `runs-test-${ts}.example.com`,
      })
      .returning({ id: brands.id });
    testBrandId = brand.id;
    await db.insert(orgBrands).values({ orgId: testOrgId, brandId: testBrandId });
  });

  afterAll(async () => {
    try {
      await db.delete(orgBrands).where(eq(orgBrands.orgId, testOrgId));
      await db.delete(brands).where(eq(brands.id, testBrandId));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get(`/internal/brands/${testBrandId}/runs`);

    expect(response.status).toBe(401);
  });

  it('should return 400 for non-UUID brand id', async () => {
    const response = await request(app)
      .get('/internal/brands/not-a-uuid/runs')
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(400);
  });

  it('should return 404 for non-existent brand', async () => {
    const response = await request(app)
      .get(`/internal/brands/${randomUUID()}/runs`)
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(404);
  });

  it('should return runs for an existing brand', async () => {
    const response = await request(app)
      .get(`/internal/brands/${testBrandId}/runs`)
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(200);
    expect(response.body.runs).toBeDefined();
    expect(Array.isArray(response.body.runs)).toBe(true);
  });
});
