import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgs, users } from '../../src/db/schema';
import { eq, like, inArray } from 'drizzle-orm';

const app = createTestApp();

describe('GET /brands - List Brands', () => {
  const testPrefix = 'test_listbrands_';

  afterEach(async () => {
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.orgId, `${testPrefix}%`));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
      await db.delete(users).where(inArray(users.orgId, orgIds));
    }
    await db.delete(orgs).where(like(orgs.orgId, `${testPrefix}%`));
  });

  it('should return brands when queried with orgId only (no appId)', async () => {
    const orgId = `${testPrefix}${Date.now()}_noappid`;
    const url = 'https://list-noappid-test.example.com';
    const userId = `${testPrefix}${Date.now()}_user`;

    // Create a brand first
    const createRes = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: 'test-app', orgId, url, userId });

    expect(createRes.status).toBe(200);

    // List brands with orgId only — this was the regression
    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders())
      .query({ orgId });

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toBeDefined();
    expect(listRes.body.brands.length).toBe(1);
    expect(listRes.body.brands[0].domain).toBe('list-noappid-test.example.com');
  }, 10000);

  it('should return brands when queried with orgId and appId', async () => {
    const orgId = `${testPrefix}${Date.now()}_withappid`;
    const url = 'https://list-withappid-test.example.com';
    const userId = `${testPrefix}${Date.now()}_user`;

    const createRes = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: 'test-app', orgId, url, userId });

    expect(createRes.status).toBe(200);

    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders())
      .query({ orgId, appId: 'test-app' });

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toBeDefined();
    expect(listRes.body.brands.length).toBe(1);
    expect(listRes.body.brands[0].domain).toBe('list-withappid-test.example.com');
  }, 10000);

  it('should return empty array for unknown orgId', async () => {
    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders())
      .query({ orgId: 'nonexistent_org_id' });

    expect(listRes.status).toBe(200);
    expect(listRes.body.brands).toEqual([]);
  });

  it('should return 400 when orgId is missing', async () => {
    const listRes = await request(app)
      .get('/brands')
      .set(getAuthHeaders());

    expect(listRes.status).toBe(400);
    expect(listRes.body.error).toBe('Invalid request');
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .get('/brands')
      .query({ orgId: 'org_123' });

    expect(response.status).toBe(401);
  });
});
