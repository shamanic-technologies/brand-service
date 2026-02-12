import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands - Upsert Brand', () => {
  const testPrefix = 'test_upsert_';

  afterEach(async () => {
    await db.delete(brands).where(like(brands.clerkOrgId, `${testPrefix}%`));
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

    // Verify brand exists in DB
    const dbBrands = await db
      .select()
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId));
    expect(dbBrands.length).toBe(1);
    expect(dbBrands[0].id).toBe(response.body.brandId);
  }, 10000);

  it('should return existing brand with created=false on second call', async () => {
    const clerkOrgId = `${testPrefix}${Date.now()}_existing`;
    const url = 'https://existing-upsert-test.example.com';

    // First call creates
    const first = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    // Second call returns existing
    const second = await request(app)
      .post('/brands')
      .set(getAuthHeaders())
      .send({ clerkOrgId, url });

    expect(second.status).toBe(200);
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);

    // Verify only one brand in DB
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
});
