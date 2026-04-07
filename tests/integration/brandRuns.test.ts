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
  const testOrgId = `test-runs-${Date.now()}`;

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
      await db.delete(brands).where(like(brands.orgId, 'test-runs-%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get(`/internal/brands/${testBrandId}/runs`);

    expect(response.status).toBe(401);
  });

  it('should return 404 for non-existent brand', async () => {
    const response = await request(app)
      .get('/internal/brands/00000000-0000-0000-0000-000000000000/runs')
      .set(getAuthHeaders());

    expect(response.status).toBe(404);
  });

  it('should return runs list for valid brand', async () => {
    const response = await request(app)
      .get(`/internal/brands/${testBrandId}/runs`)
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('runs');
    expect(Array.isArray(response.body.runs)).toBe(true);
  });

  it('should pass query params to listRuns', async () => {
    const { listRuns } = await import('../../src/lib/runs-client');

    const response = await request(app)
      .get(`/internal/brands/${testBrandId}/runs`)
      .query({ taskName: 'sales-profile-extraction', limit: '10' })
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: testOrgId,
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        limit: 10,
      })
    );
  });
});
