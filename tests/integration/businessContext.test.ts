import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandBusinessContext } from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * No-website brand lifecycle:
 *  - POST /orgs/brands { name }         → create a brand with no URL
 *  - PUT  /orgs/brands/:id/business-context → store the pasted extraction source
 *  - GET  /orgs/brands/:id/business-context → read it back
 *  - PATCH /orgs/brands/:id { url }      → attach a website later
 *  - regression: POST /orgs/brands { url } unchanged
 */
describe('Business context & no-website brands', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const foreignBrandId = randomUUID();
  const unknownBrandId = randomUUID();

  const createdBrandIds: string[] = [];

  beforeAll(async () => {
    // A website brand owned by another org (for ownership 403).
    await db.insert(brands).values({
      id: foreignBrandId,
      url: 'https://foreign-bc.com',
      domain: 'foreign-bc.com',
      name: 'Foreign',
    });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
    createdBrandIds.push(foreignBrandId);
  });

  // One statement per table, not one per brand: the per-brand loop this replaces issued
  // 3 round-trips × ~9 brands, which overruns vitest's separate 10s hook budget as soon as
  // the database is a freshly provisioned (cold, cross-region) branch rather than a warm one.
  afterAll(async () => {
    if (createdBrandIds.length === 0) return;
    await db
      .delete(brandBusinessContext)
      .where(inArray(brandBusinessContext.brandId, createdBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  });

  async function createNoWebsiteBrand(name: string): Promise<string> {
    const res = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(ownerOrgId))
      .send({ name });
    expect(res.status).toBe(200);
    createdBrandIds.push(res.body.brandId);
    return res.body.brandId;
  }

  it('POST /orgs/brands { name } creates a no-website brand (url + domain null)', async () => {
    const brandId = await createNoWebsiteBrand('Acme Consulting (no site)');

    const [row] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    expect(row.url).toBeNull();
    expect(row.domain).toBeNull();
    expect(row.name).toBe('Acme Consulting (no site)');

    // org_brands membership was written.
    const membership = await db.select().from(orgBrands).where(eq(orgBrands.brandId, brandId));
    expect(membership.length).toBe(1);
    expect(membership[0].orgId).toBe(ownerOrgId);
  });

  it('POST /orgs/brands with neither url nor name → 400', async () => {
    const res = await request(app).post('/orgs/brands').set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(400);
  });

  it('POST /orgs/brands with both url and name → 400', async () => {
    const res = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(ownerOrgId))
      .send({ url: 'https://both.com', name: 'Both' });
    expect(res.status).toBe(400);
  });

  it('POST /orgs/brands { url } still works (regression)', async () => {
    const res = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(ownerOrgId))
      .send({ url: 'https://regression-bc.com' });
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe('regression-bc.com');
    createdBrandIds.push(res.body.brandId);
  });

  it('PUT + GET business-context round-trips', async () => {
    const brandId = await createNoWebsiteBrand('Roundtrip Brand');
    const content = 'We are a boutique agency selling brand strategy and design retainers.';

    const put = await request(app)
      .put(`/orgs/brands/${brandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ content });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ content });

    const get = await request(app)
      .get(`/orgs/brands/${brandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId));
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ content });
  });

  it('GET business-context returns null when unset', async () => {
    const brandId = await createNoWebsiteBrand('Unset Context Brand');
    const res = await request(app)
      .get(`/orgs/brands/${brandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  // This is the only test in the repo that moves a megabyte, and it moves it four
  // times: request body in, INSERT out, SELECT back, response body out. Against the
  // throwaway Neon branch CI provisions in ap-southeast-1 that does not reliably fit
  // in the 10s default, so the suite went red on a genuinely passing assertion.
  // Timing, not behaviour — hence an explicit budget rather than a smaller payload,
  // which would stop testing the thing the test exists for (the 2mb body cap).
  it('PUT accepts a ~1MB business context without a body-size error', async () => {
    const brandId = await createNoWebsiteBrand('Big Context Brand');
    const bigContent = 'A'.repeat(1_000_000); // ~1MB

    const put = await request(app)
      .put(`/orgs/brands/${brandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ content: bigContent });
    expect(put.status).toBe(200);
    expect(put.body.content.length).toBe(1_000_000);
  }, 60_000);

  it('PUT empty content → 400', async () => {
    const brandId = await createNoWebsiteBrand('Empty Content Brand');
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('business-context is ownership-scoped (403 foreign, 404 unknown)', async () => {
    const foreign = await request(app)
      .get(`/orgs/brands/${foreignBrandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId));
    expect(foreign.status).toBe(403);

    const unknown = await request(app)
      .get(`/orgs/brands/${unknownBrandId}/business-context`)
      .set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);
  });

  it('GET /internal/brands/:id for a no-website brand returns null url/domain and the name', async () => {
    const brandId = await createNoWebsiteBrand('Internal Read Brand');
    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.brand.url).toBeNull();
    expect(res.body.brand.domain).toBeNull();
    expect(res.body.brand.name).toBe('Internal Read Brand');
    // No landing URL → no click-destination default.
    expect(res.body.brand.clickDestinationUrl).toBeNull();
  });

  it('PATCH /orgs/brands/:id { url } attaches a website (sets url + domain)', async () => {
    const brandId = await createNoWebsiteBrand('Will Get Website');

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ url: 'https://latersite.com' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://latersite.com');
    expect(res.body.domain).toBe('latersite.com');

    const [row] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    expect(row.url).toBe('https://latersite.com');
    expect(row.domain).toBe('latersite.com');
  });

  it('PATCH is ownership-scoped (403 for a foreign brand)', async () => {
    const res = await request(app)
      .patch(`/orgs/brands/${foreignBrandId}`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ url: 'https://hijack.com' });
    expect(res.status).toBe(403);
  });
});
