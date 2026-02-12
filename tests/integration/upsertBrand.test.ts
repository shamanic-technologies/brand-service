import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgs, users } from '../../src/db/schema';
import { eq, like, and } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands - Upsert Brand', () => {
  const testPrefix = 'test_upsert_';

  afterEach(async () => {
    // Delete brands first (FK to orgs via org_id)
    await db.delete(brands).where(like(brands.clerkOrgId, `${testPrefix}%`));
    // Delete users (FK to orgs via org_id)
    await db.delete(users).where(like(users.clerkUserId, `${testPrefix}%`));
    // Delete orgs
    await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .post('/brands')
      .send({ clerkOrgId: 'org_123', url: 'https://example.com' });

    expect(response.status).toBe(401);
  });

  it('should return 400 if clerkOrgId is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ url: 'https://example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should return 400 if url is missing', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId: 'org_123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should create a new brand and return created=true', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_new`;
    const url = 'https://new-upsert-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(response.status).toBe(200);
    expect(response.body.brandId).toBeDefined();
    expect(response.body.domain).toBe('new-upsert-test.example.com');
    expect(response.body.created).toBe(true);

    // Verify brand exists in DB with org_id set
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbBrands.length).toBe(1);
    expect(dbBrands[0].id).toBe(response.body.brandId);
    expect(dbBrands[0].orgId).toBeDefined();
  }, 10000);

  it('should return existing brand with created=false on second call', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_existing`;
    const url = 'https://existing-upsert-test.example.com';

    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(second.status).toBe(200);
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);

    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbBrands.length).toBe(1);
  }, 10000);

  it('should create separate brands for different domains under same org', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_multi`;
    const url1 = 'https://brand-one.example.com';
    const url2 = 'https://brand-two.example.com';

    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url: url1 });

    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url: url2 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.brandId).not.toBe(second.body.brandId);
    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(true);

    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbBrands.length).toBe(2);
  }, 10000);

  it('should strip www. from domain', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_www`;
    const url = 'https://www.strip-www-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('strip-www-test.example.com');
  }, 10000);

  it('should handle URLs without protocol', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_noprotocol`;
    const url = 'no-protocol-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('no-protocol-test.example.com');
    expect(response.body.created).toBe(true);
  }, 10000);

  // --- New tests for appId / clerkUserId / org resolution ---

  it('should create org row with default appId=mcpfactory', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_defaultapp`;
    const url = 'https://default-app-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(response.status).toBe(200);

    // Verify org was created with appId=mcpfactory
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgId)));
    expect(dbOrgs.length).toBe(1);

    // Verify brand has org_id set
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbBrands[0].orgId).toBe(dbOrgs[0].id);
  }, 10000);

  it('should create org row with custom appId', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_customapp`;
    const url = 'https://custom-app-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: 'pressbeat', clerkOrgId, url });

    expect(response.status).toBe(200);

    // Verify org was created with appId=pressbeat
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(and(eq(orgs.appId, 'pressbeat'), eq(orgs.clerkOrgId, clerkOrgId)));
    expect(dbOrgs.length).toBe(1);
  }, 10000);

  it('should reuse existing org on second call', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_reuseorg`;
    const url1 = 'https://reuse-org-one.example.com';
    const url2 = 'https://reuse-org-two.example.com';

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url: url1 });

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url: url2 });

    // Should still be only one org
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.clerkOrgId, clerkOrgId));
    expect(dbOrgs.length).toBe(1);
  }, 10000);

  it('should create user when clerkUserId is provided', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_withuser`;
    const clerkUserId = `${testPrefix}${Date.now()}_user`;
    const url = 'https://with-user-test.example.com';

    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url, clerkUserId });

    expect(response.status).toBe(200);

    // Verify user was created with org_id set
    const dbUsers = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId));
    expect(dbUsers.length).toBe(1);
    expect(dbUsers[0].orgId).toBeDefined();

    // Verify user's orgId matches the brand's orgId
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbUsers[0].orgId).toBe(dbBrands[0].orgId);
  }, 10000);

  it('should allow same clerkOrgId with different appIds', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_multiapp`;
    const url1 = 'https://multi-app-one.example.com';
    const url2 = 'https://multi-app-two.example.com';

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: 'app-one', clerkOrgId, url: url1 });

    await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ appId: 'app-two', clerkOrgId, url: url2 });

    // Should have two separate orgs
    const dbOrgs = await db
      .select()
      .from(orgs)
      .where(eq(orgs.clerkOrgId, clerkOrgId));
    expect(dbOrgs.length).toBe(2);
    expect(dbOrgs.map(o => o.appId).sort()).toEqual(['app-one', 'app-two']);
  }, 10000);
});
