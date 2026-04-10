import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
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

    // Verify brand exists in DB with orgId set
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(dbBrands.length).toBe(1);
    expect(dbBrands[0].id).toBe(response.body.brandId);
    expect(dbBrands[0].orgId).toBe(orgId);
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

    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(dbBrands.length).toBe(1);
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

    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(dbBrands.length).toBe(2);
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
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.orgId, orgId));
    expect(dbBrands.length).toBe(2);
  }, 10000);

  it('should allow two different orgs to upsert brands with the same domain', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    createdOrgIds.push(orgId1, orgId2);
    const url = 'https://shared-upsert-domain.example.com';

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
    expect(second.body.brandId).not.toBe(first.body.brandId);
    expect(second.body.domain).toBe('shared-upsert-domain.example.com');
  }, 10000);
});
