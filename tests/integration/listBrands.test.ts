import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

describe('GET /brands - List Brands', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('should return brands for the org identified by x-org-id header', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://list-default-test.example.com';

    // Create a brand first
    const createRes = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(createRes.status).toBe(200);

    // List brands — orgId comes from header now
    const listRes = await request(app)
      .get('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()));

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toBeDefined();
    expect(listRes.body.brands.length).toBe(1);
    expect(listRes.body.brands[0].domain).toBe('list-default-test.example.com');
  }, 10000);

  it('should return empty array for unknown orgId', async () => {
    const listRes = await request(app)
      .get('/orgs/brands')
      .set(getAuthHeaders(randomUUID(), randomUUID()));

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get('/orgs/brands');

    expect(response.status).toBe(401);
  });
});
