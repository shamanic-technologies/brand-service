import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('GET /brands - List Brands', () => {
  const testPrefix = 'test-listbrands-';

  afterEach(async () => {
    await db.delete(brands).where(like(brands.orgId, `${testPrefix}%`));
  });

  it('should return brands for the org identified by x-org-id header', async () => {
    const orgId = `${testPrefix}${Date.now()}_default`;
    const url = 'https://list-default-test.example.com';

    // Create a brand first
    const createRes = await request(app)
      .post('/brands')
      .set(getAuthHeaders(orgId, 'test-user-uuid'))
      .send({ url });

    expect(createRes.status).toBe(200);

    // List brands — orgId comes from header now
    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders(orgId, 'test-user-uuid'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toBeDefined();
    expect(listRes.body.brands.length).toBe(1);
    expect(listRes.body.brands[0].domain).toBe('list-default-test.example.com');
  }, 10000);

  it('should return empty array for unknown orgId', async () => {
    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders('nonexistent_org_id', 'test-user-uuid'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get('/brands');

    expect(response.status).toBe(401);
  });
});
