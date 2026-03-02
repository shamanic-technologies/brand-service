import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgs } from '../../src/db/schema';
import { eq, like, inArray } from 'drizzle-orm';

const app = createTestApp();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('GET /org-ids', () => {
  const testAppId = 'test_orgids_app';

  afterEach(async () => {
    const testOrgs = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(like(orgs.appId, 'test_orgids_%'));

    if (testOrgs.length > 0) {
      const orgInternalIds = testOrgs.map(o => o.id);
      await db.delete(brands).where(inArray(brands.orgId, orgInternalIds));
    }
    await db.delete(orgs).where(like(orgs.appId, 'test_orgids_%'));
  });

  it('should require authentication', async () => {
    const response = await request(app).get('/org-ids');
    expect(response.status).toBe(401);
  });

  it('should return only valid UUID org_ids', async () => {
    // Insert an org with a valid UUID org_id and a brand
    const uuidOrgId = randomUUID();
    const [org] = await db
      .insert(orgs)
      .values({ appId: testAppId, orgId: uuidOrgId })
      .returning();

    await db.insert(brands).values({
      name: 'Test Brand',
      url: 'https://test-orgids.example.com',
      domain: 'test-orgids.example.com',
      orgId: org.id,
    });

    // Insert an org with a Clerk-style ID (legacy data) and a brand
    const [clerkOrg] = await db
      .insert(orgs)
      .values({ appId: `${testAppId}_clerk`, orgId: 'org_CLERK_TEST_123' })
      .returning();

    await db.insert(brands).values({
      name: 'Clerk Brand',
      url: 'https://clerk-orgids.example.com',
      domain: 'clerk-orgids.example.com',
      orgId: clerkOrg.id,
    });

    const response = await request(app)
      .get('/org-ids')
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.organization_ids)).toBe(true);
    expect(response.body.count).toBe(response.body.organization_ids.length);

    // All returned IDs should be valid UUIDs
    for (const id of response.body.organization_ids) {
      expect(UUID_REGEX.test(id)).toBe(true);
    }

    // The UUID org_id should be present
    expect(response.body.organization_ids).toContain(uuidOrgId);

    // The Clerk-style org_id should NOT be present
    expect(response.body.organization_ids).not.toContain('org_CLERK_TEST_123');
  }, 15000);

  it('should support appId filter', async () => {
    const specificApp = 'test_orgids_specific';
    const otherApp = 'test_orgids_other';
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();

    // Create org+brand for specific app
    const [org1] = await db
      .insert(orgs)
      .values({ appId: specificApp, orgId: orgId1 })
      .returning();
    await db.insert(brands).values({
      name: 'Specific Brand',
      url: 'https://specific.example.com',
      domain: 'specific.example.com',
      orgId: org1.id,
    });

    // Create org+brand for other app
    const [org2] = await db
      .insert(orgs)
      .values({ appId: otherApp, orgId: orgId2 })
      .returning();
    await db.insert(brands).values({
      name: 'Other Brand',
      url: 'https://other.example.com',
      domain: 'other.example.com',
      orgId: org2.id,
    });

    // Filter by specific app
    const response = await request(app)
      .get('/org-ids')
      .query({ appId: specificApp })
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(response.body.organization_ids).toContain(orgId1);
    expect(response.body.organization_ids).not.toContain(orgId2);
  }, 15000);

  it('should return empty for nonexistent appId', async () => {
    const response = await request(app)
      .get('/org-ids')
      .query({ appId: 'nonexistent-app-xyz' })
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(response.body.organization_ids).toEqual([]);
    expect(response.body.count).toBe(0);
  }, 15000);
});

describe('UUID validation on creation endpoints', () => {
  it('POST /brands should reject Clerk ID for orgId', async () => {
    const response = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({
        appId: 'test-app',
        orgId: 'org_38y0ZSEvK2Pj1',
        url: 'https://example.com',
        userId: 'user-1',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('PUT /set-url should reject Clerk ID for organization_id', async () => {
    const response = await request(app)
      .put('/set-url')
      .set(getAuthHeaders())
      .send({ organization_id: 'org_38y0ZSEvK2Pj1', url: 'https://example.com' });

    expect(response.status).toBe(400);
  });
});
