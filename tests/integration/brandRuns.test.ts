import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

// Mock runs-client to avoid calling real runs-service in tests
vi.mock('../../src/lib/runs-client', () => ({
  listRuns: vi.fn().mockResolvedValue({ runs: [], limit: 50, offset: 0 }),
}));

const app = createTestApp();

describe('GET /brands/:id/runs - Integration Tests', () => {
  let testBrandId: string;
  const testClerkOrgId = `org_test_runs_${Date.now()}`;

  beforeAll(async () => {
    // Create a test brand
    const [brand] = await db
      .insert(brands)
      .values({
        clerkOrgId: testClerkOrgId,
        url: `https://runs-test-${Date.now()}.example.com`,
        domain: `runs-test-${Date.now()}.example.com`,
      })
      .returning({ id: brands.id });
    testBrandId = brand.id;
  });

  afterAll(async () => {
    try {
      await db.delete(brands).where(like(brands.clerkOrgId, 'org_test_runs_%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get(`/brands/${testBrandId}/runs`);

    expect(response.status).toBe(401);
  });

  it('should return 404 for non-existent brand', async () => {
    const response = await request(app)
      .get('/brands/00000000-0000-0000-0000-000000000000/runs')
      .set(getAuthHeaders());

    expect(response.status).toBe(404);
  });

  it('should return runs list for valid brand', async () => {
    const response = await request(app)
      .get(`/brands/${testBrandId}/runs`)
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('runs');
    expect(Array.isArray(response.body.runs)).toBe(true);
  });

  it('should return empty runs for brand without clerkOrgId', async () => {
    // Create a brand without clerkOrgId
    const [brandNoOrg] = await db
      .insert(brands)
      .values({
        url: `https://no-org-runs-${Date.now()}.example.com`,
        domain: `no-org-runs-${Date.now()}.example.com`,
      })
      .returning({ id: brands.id });

    const response = await request(app)
      .get(`/brands/${brandNoOrg.id}/runs`)
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(response.body.runs).toEqual([]);

    // Cleanup
    await db.delete(brands).where(eq(brands.id, brandNoOrg.id));
  });

  it('should pass query params to listRuns', async () => {
    const { listRuns } = await import('../../src/lib/runs-client');

    const response = await request(app)
      .get(`/brands/${testBrandId}/runs`)
      .query({ taskName: 'sales-profile-extraction', limit: '10' })
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkOrgId: testClerkOrgId,
        appId: 'mcpfactory',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        limit: 10,
      })
    );
  });
});
