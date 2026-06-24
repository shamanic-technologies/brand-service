import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandClickDestinations } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Per-brand click destination URL.
 * PUT /orgs/brands/:brandId/click-destination — org-ownership enforced.
 * Read back via the `clickDestinationUrl` field on the brand read
 * (GET /internal/brands/:id, GET /internal/brands?ids=).
 */
describe('Click Destination Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  beforeAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://click-dest-${id.slice(0, 8)}.com`,
        domain: `click-dest-${id.slice(0, 8)}.com`,
        name: 'Click Dest Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: unsetBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.delete(brandClickDestinations).where(eq(brandClickDestinations.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const path = (id: string) => `/orgs/brands/${id}/click-destination`;

  // AC2 — persist a valid http(s) URL, returns the saved value
  it('PUT a valid https URL returns 200 with the saved value', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com/welcome' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clickDestinationUrl: 'https://example.com/welcome' });
  });

  it('PUT a valid http URL is accepted', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'http://example.com/page' });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe('http://example.com/page');
  });

  // AC1 — read back via the internal brand read
  it('GET /internal/brands/:id returns the saved clickDestinationUrl', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com/landing' });

    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.clickDestinationUrl).toBe('https://example.com/landing');
  });

  // AC1 — unset brand reads clickDestinationUrl: null (additive, no break)
  it('GET /internal/brands/:id for an unset brand returns clickDestinationUrl: null', async () => {
    const res = await request(app)
      .get(`/internal/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand).toHaveProperty('clickDestinationUrl', null);
  });

  // AC1 — batch read also carries the field
  it('GET /internal/brands?ids= batch read carries clickDestinationUrl per brand', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com/batch' });

    const res = await request(app)
      .get(`/internal/brands?ids=${brandId},${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const set = res.body.brands.find((b: any) => b.id === brandId);
    const unset = res.body.brands.find((b: any) => b.id === unsetBrandId);
    expect(set.clickDestinationUrl).toBe('https://example.com/batch');
    expect(unset.clickDestinationUrl).toBeNull();
  });

  // AC2 — idempotent: re-PUT a new value overwrites
  it('PUT is idempotent — a second write overwrites the value', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com/v1' });
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com/v2' });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe('https://example.com/v2');
  });

  // AC2 — reject non-http(s) URL
  it('PUT an ftp URL is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'ftp://example.com/file' });

    expect(res.status).toBe(400);
  });

  // AC2 — reject unparseable / non-URL input
  it('PUT a non-URL string is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'not a url' });

    expect(res.status).toBe(400);
  });

  it('PUT a missing clickDestinationUrl is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
  });

  // Ownership / id semantics mirror the sales-economics write
  it('PUT a non-UUID brand id is rejected 400', async () => {
    const res = await request(app)
      .put(path('not-a-uuid'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com' });

    expect(res.status).toBe(400);
  });

  it('PUT a brand owned by another org is rejected 403', async () => {
    const res = await request(app)
      .put(path(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com' });

    expect(res.status).toBe(403);
  });

  it('PUT an unknown brand is rejected 404', async () => {
    const res = await request(app)
      .put(path(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com' });

    expect(res.status).toBe(404);
  });
});
