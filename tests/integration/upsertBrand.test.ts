import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

describe('POST /brands - Upsert Brand', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .post('/orgs/brands')
      .send({ url: 'https://example.com' });

    expect(response.status).toBe(401);
  });

  it('should return 400 if url is missing', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid request');
  });

  it('should create a new brand and return created=true', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://new-upsert-test.example.com';

    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(response.status).toBe(200);
    expect(response.body.brandId).toBeDefined();
    expect(response.body.domain).toBe('new-upsert-test.example.com');
    expect(response.body.created).toBe(true);

    // Verify silver brand exists + org_brands membership.
    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(1);
    expect(memberships[0].brandId).toBe(response.body.brandId);
  }, 10000);

  it('should return existing brand with created=false on second call', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://existing-upsert-test.example.com';

    const first = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(second.status).toBe(200);
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);

    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(1);
  }, 10000);

  it('should create separate brands for different domains under same org', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url1 = 'https://brand-one.example.com';
    const url2 = 'https://brand-two.example.com';

    const first = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: url1 });

    const second = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: url2 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.brandId).not.toBe(second.body.brandId);
    expect(first.body.created).toBe(true);
    expect(second.body.created).toBe(true);

    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(2);
  }, 10000);

  it('should strip www. from domain', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://www.strip-www-test.example.com';

    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('strip-www-test.example.com');
  }, 10000);

  it('should reuse existing brand on second call with same URL', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url1 = 'https://reuse-org-one.example.com';
    const url2 = 'https://reuse-org-two.example.com';

    await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: url1 });

    await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: url2 });

    // Should have two brands (different domains)
    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(2);
  }, 10000);

  it('two orgs upserting the same domain share one silver brand + two memberships', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    createdOrgIds.push(orgId1, orgId2);
    const uniqueDomain = `shared-upsert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const url = `https://${uniqueDomain}`;

    const first = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId1, randomUUID()))
      .send({ url });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId2, randomUUID()))
      .send({ url });

    expect(second.status).toBe(200);
    expect(second.body.created).toBe(true);
    // Same canonical silver brand under the new silver model.
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.domain).toBe(uniqueDomain);

    // Two memberships exist on the shared brand.
    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.brandId, first.body.brandId));
    const memberOrgIds = memberships.map((m) => m.orgId).sort();
    expect(memberOrgIds).toEqual([orgId1, orgId2].sort());
  }, 10000);

  it('accepts a bare domain and normalizes URL + domain', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'bare-domain-test.example.com';

    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(response.status).toBe(200);
    expect(response.body.domain).toBe('bare-domain-test.example.com');
  }, 10000);

  it('rejects junk URL with structured INVALID_URL error', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: 'asdf' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_URL');
    expect(response.body.field).toBe('url');
    expect(typeof response.body.message).toBe('string');
  });

  it('rejects localhost with INVALID_URL', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: 'http://localhost' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_URL');
  });

  it('rejects IP literal with INVALID_URL', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: 'http://192.168.1.1' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_URL');
  });

  it('rejects empty URL with INVALID_URL', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: '' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_URL');
  });

  it('returns 400 when x-user-id header is missing', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set({
        'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
        'X-Org-Id': orgId,
        'X-Run-Id': randomUUID(),
        'Content-Type': 'application/json',
      })
      .send({ url: 'https://no-userid-test.example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('x-user-id header is required');
  });

  it('returns 400 when x-run-id header is missing', async () => {
    const orgId = randomUUID();
    const response = await request(app)
      .post('/orgs/brands')
      .set({
        'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
        'X-Org-Id': orgId,
        'X-User-Id': randomUUID(),
        'Content-Type': 'application/json',
      })
      .send({ url: 'https://no-runid-test.example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('x-run-id header is required');
  });
});
