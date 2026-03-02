import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgs, users } from '../../src/db/schema';
import { eq, like, inArray } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands - Upsert Brand', () => {
  // Use a unique appId prefix for test cleanup (orgId is now UUID, can't use prefix)
  const testAppPrefix = 'test_upsert_';
  const testApp = `${testAppPrefix}default`;

  afterEach(async () => {
    // Find test orgs by appId prefix
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.appId, `${testAppPrefix}%`));

    if (testOrgs.length > 0) {
      const orgIds = testOrgs.map(o => o.id);
      // Delete brands first (FK to orgs via org_id)
      await db.delete(brands).where(inArray(brands.orgId, orgIds));
      // Delete users (FK to orgs via org_id)
      await db.delete(users).where(inArray(users.orgId, orgIds));
    }
    // Delete orgs
    await db.delete(orgs).where(like(orgs.appId, `${testAppPrefix}%`));
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .post('/brands')
      .send({ appId: testApp, orgId: randomUUID(), url: 'https://example.com', userId: 'user_123' });

    expect(response.status).toBe(401);
  });

  it('should return 400 if orgId is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, url: 'https://example.com', userId: 'user_123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should return 400 if url is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId: randomUUID(), userId: 'user_123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should return 400 if appId is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ orgId: randomUUID(), url: 'https://example.com', userId: 'user_123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should return 400 if userId is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId: randomUUID(), url: 'https://example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should return 400 if orgId is not a valid UUID', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId: 'org_38y0ZSEvK2Pj1', url: 'https://example.com', userId: 'user_123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should create a new brand and return created=true', async () => {
    const orgId = randomUUID();
    const url = 'https://new-upsert-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId: `test_user_${Date.now()}` });

    expect(response.status).toBe(200);
    expect(response.body.brandId).toBeDefined();
    expect(response.body.domain).toBe('new-upsert-test.example.com');
    expect(response.body.created).toBe(true);

    // Verify brand exists in DB with org_id set
    const [org] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    expect(org).toBeDefined();

    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(dbBrands.length).toBe(1);
    expect(dbBrands[0].id).toBe(response.body.brandId);
    expect(dbBrands[0].orgId).toBe(org.id);
  }, 10000);

  it('should return existing brand with created=false on second call', async () => {
    const orgId = randomUUID();
    const url = 'https://existing-upsert-test.example.com';
    const userId = `test_user_${Date.now()}`;

    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId });

    expect(second.status).toBe(200);
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);

    const [org] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(dbBrands.length).toBe(1);
  }, 10000);

  it('should create separate brands for different domains under same org', async () => {
    const orgId = randomUUID();
    const userId = `test_user_${Date.now()}`;
    const url1 = 'https://brand-one.example.com';
    const url2 = 'https://brand-two.example.com';

    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url: url1, userId });

    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url: url2, userId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.brandId).not.toBe(second.body.brandId);
    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(true);

    const [org] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(dbBrands.length).toBe(2);
  }, 10000);

  it('should strip www. from domain', async () => {
    const orgId = randomUUID();
    const url = 'https://www.strip-www-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId: `test_user_${Date.now()}` });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('strip-www-test.example.com');
  }, 10000);

  it('should handle URLs without protocol', async () => {
    const orgId = randomUUID();
    const url = 'no-protocol-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId: `test_user_${Date.now()}` });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('no-protocol-test.example.com');
    expect(response.body.created).toBe(true);
  }, 10000);

  // --- Tests for appId / userId / org resolution ---

  it('should create org row with the specified appId', async () => {
    const orgId = randomUUID();
    const url = 'https://default-app-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId: `test_user_${Date.now()}` });

    expect(response.status).toBe(200);

    // Verify org was created with the specified appId
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    expect(dbOrgs.length).toBe(1);
    expect(dbOrgs[0].appId).toBe(testApp);

    // Verify brand has org_id set
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, dbOrgs[0].id));
    expect(dbBrands.length).toBe(1);
    expect(dbBrands[0].orgId).toBe(dbOrgs[0].id);
  }, 10000);

  it('should create org row with custom appId', async () => {
    const orgId = randomUUID();
    const url = 'https://custom-app-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: `${testAppPrefix}pressbeat`, orgId, url, userId: `test_user_${Date.now()}` });

    expect(response.status).toBe(200);

    // Verify org was created with the custom appId
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    expect(dbOrgs.length).toBe(1);
    expect(dbOrgs[0].appId).toBe(`${testAppPrefix}pressbeat`);
  }, 10000);

  it('should reuse existing org on second call', async () => {
    const orgId = randomUUID();
    const userId = `test_user_${Date.now()}`;
    const url1 = 'https://reuse-org-one.example.com';
    const url2 = 'https://reuse-org-two.example.com';

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url: url1, userId });

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url: url2, userId });

    // Should still be only one org
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    expect(dbOrgs.length).toBe(1);
  }, 10000);

  it('should create user when userId is provided', async () => {
    const orgId = randomUUID();
    const userId = `test_user_${Date.now()}`;
    const url = 'https://with-user-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId, url, userId });

    expect(response.status).toBe(200);

    // Verify user was created with org_id set
    const dbUsers = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));
    expect(dbUsers.length).toBe(1);
    expect(dbUsers[0].orgId).toBeDefined();

    // Verify user's orgId matches the brand's orgId
    const [org] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, org.id));
    expect(dbUsers[0].orgId).toBe(dbBrands[0].orgId);
  }, 10000);

  it('should allow two different orgs to upsert brands with the same domain', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    const url = 'https://shared-upsert-domain.example.com';

    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId: orgId1, url, userId: `test_user_${Date.now()}_A` });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: testApp, orgId: orgId2, url, userId: `test_user_${Date.now()}_B` });

    expect(second.status).toBe(200);
    expect(second.body.created).toBe(true);
    expect(second.body.brandId).not.toBe(first.body.brandId);
    expect(second.body.domain).toBe('shared-upsert-domain.example.com');
  }, 10000);

  it('should allow same orgId with different appIds', async () => {
    const orgId = randomUUID();
    const url1 = 'https://multi-app-one.example.com';
    const url2 = 'https://multi-app-two.example.com';

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: `${testAppPrefix}app_one`, orgId, url: url1, userId: `test_user_${Date.now()}_1` });

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: `${testAppPrefix}app_two`, orgId, url: url2, userId: `test_user_${Date.now()}_2` });

    // Should have two separate orgs
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.orgId, orgId));
    expect(dbOrgs.length).toBe(2);
    expect(dbOrgs.map(o => o.appId).sort()).toEqual([`${testAppPrefix}app_one`, `${testAppPrefix}app_two`]);
  }, 10000);
});
