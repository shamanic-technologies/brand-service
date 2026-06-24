import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandClickDestination } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Brand-level click-destination URL.
 * PUT /orgs/brands/:brandId/click-destination — org-ownership enforced.
 * Read field `clickDestinationUrl` surfaces on the brand read responses.
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
      await db.delete(brandClickDestination).where(eq(brandClickDestination.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const putPath = (id: string) => `/orgs/brands/${id}/click-destination`;

  // AC2 — valid http(s) URL persists and is returned (normalized)
  it('PUT a valid https URL persists it and returns the saved value', async () => {
    const res = await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com/welcome' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clickDestinationUrl: 'https://acme.com/welcome' });
  });

  // AC2 — idempotent: a second PUT overwrites and returns the new value
  it('PUT is idempotent — a second write overwrites the value', async () => {
    await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com/first' });

    const res = await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com/second' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clickDestinationUrl: 'https://acme.com/second' });
  });

  // AC1 — read field is null when unset, the saved value after a write
  it('brand read returns clickDestinationUrl: null when unset, then the saved value', async () => {
    const before = await request(app)
      .get(`/public/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders());
    expect(before.status).toBe(200);
    expect(before.body.brand.clickDestinationUrl).toBeNull();

    await request(app)
      .put(putPath(unsetBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com/landing' });

    const after = await request(app)
      .get(`/public/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders());
    expect(after.status).toBe(200);
    expect(after.body.brand.clickDestinationUrl).toBe('https://acme.com/landing');
  });

  // AC1 — the by-ids batch read also carries the field
  it('batch brand read carries clickDestinationUrl', async () => {
    const res = await request(app)
      .get(`/public/brands?ids=${brandId},${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.brands.map((b: any) => [b.id, b]));
    expect(byId[brandId]).toHaveProperty('clickDestinationUrl');
    expect(byId[unsetBrandId]).toHaveProperty('clickDestinationUrl');
  });

  // AC2 — invalid input fails loud (no fallback, no silent default)
  it('PUT a non-http(s) URL is rejected 400', async () => {
    const res = await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'ftp://acme.com/file' });

    expect(res.status).toBe(400);
  });

  it('PUT a malformed URL is rejected 400', async () => {
    const res = await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'not a url at all' });

    expect(res.status).toBe(400);
  });

  it('PUT a missing clickDestinationUrl is rejected 400', async () => {
    const res = await request(app)
      .put(putPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
  });

  // Ownership — bad uuid / unknown / foreign
  it('PUT with a non-UUID brandId is rejected 400', async () => {
    const res = await request(app)
      .put('/orgs/brands/not-a-uuid/click-destination')
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com' });

    expect(res.status).toBe(400);
  });

  it('PUT an unknown brand returns 404', async () => {
    const res = await request(app)
      .put(putPath(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com' });

    expect(res.status).toBe(404);
  });

  it("PUT a brand owned by another org returns 403", async () => {
    const res = await request(app)
      .put(putPath(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://acme.com' });

    expect(res.status).toBe(403);
  });
});
