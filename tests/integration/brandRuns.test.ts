import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
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
    // Create a test brand directly (orgId stored directly in brands table)
    const [brand] = await db
      .insert(brands)
      .values({
        orgId: testOrgId,
        url: `https://runs-test-${Date.now()}.example.com`,
        domain: `runs-test-${Date.now()}.example.com`,
      })
      .returning({ id: brands.id });
    testBrandId = brand.id;
  });

  afterAll(async () => {
    try {
      await db.delete(brands).where(eq(brands.orgId, testOrgId));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get(`/orgs/brands/${testBrandId}/runs`);

    expect(response.status).toBe(401);
  });

  it('should return 400 for non-UUID brand id', async () => {
    const response = await request(app)
      .get('/orgs/brands/not-a-uuid/runs')
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(400);
  });

  it('should return 404 for non-existent brand', async () => {
    const response = await request(app)
      .get(`/orgs/brands/${randomUUID()}/runs`)
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(404);
  });

  it('should return runs for an existing brand', async () => {
    const response = await request(app)
      .get(`/orgs/brands/${testBrandId}/runs`)
      .set(getAuthHeaders(testOrgId));

    expect(response.status).toBe(200);
    expect(response.body.runs).toBeDefined();
    expect(Array.isArray(response.body.runs)).toBe(true);
  });
});
