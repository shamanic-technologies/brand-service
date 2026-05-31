import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Brand-level sales conversion economics.
 * GET/PUT /orgs/brands/:brandId/sales-economics — org-ownership enforced.
 */
describe('Sales Economics Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  const validMetrics = {
    lifetimeRevenueUsd: 4000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 12,
    meetingToClosePct: 25,
    visitToClosePct: 3,
  };

  beforeAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://sales-econ-${id.slice(0, 8)}.com`,
        domain: `sales-econ-${id.slice(0, 8)}.com`,
        name: 'Sales Econ Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: unsetBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const path = (id: string) => `/orgs/brands/${id}/sales-economics`;

  // AC2 — unset returns null, not an error
  it('GET an owned brand with nothing saved returns { salesEconomics: null }, 200', async () => {
    const res = await request(app).get(path(unsetBrandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesEconomics: null });
  });

  // AC1 — PUT then GET round-trips the exact values
  it('PUT 5 metrics then GET returns exactly those values + updatedAt', async () => {
    const putRes = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics).toMatchObject(validMetrics);
    expect(typeof putRes.body.salesEconomics.updatedAt).toBe('string');

    const getRes = await request(app).get(path(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(getRes.status).toBe(200);
    expect(getRes.body.salesEconomics).toMatchObject(validMetrics);
    expect(typeof getRes.body.salesEconomics.updatedAt).toBe('string');
  });

  // AC12 — WRITE response is non-null with updatedAt
  it('PUT response salesEconomics is non-null and carries updatedAt', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(res.status).toBe(200);
    expect(res.body.salesEconomics).not.toBeNull();
    expect(res.body.salesEconomics).toHaveProperty('updatedAt');
  });

  // AC3 — idempotent
  it('PUT twice with the same body is idempotent (same end state)', async () => {
    const first = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);
    const second = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const strip = (b: any) => ({ ...b.salesEconomics, updatedAt: undefined });
    expect(strip(second.body)).toEqual(strip(first.body));

    const getRes = await request(app).get(path(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.salesEconomics).toMatchObject(validMetrics);
  });

  // AC4 — cross-org PUT rejected
  it('PUT for a brand owned by another org is rejected with 403', async () => {
    const res = await request(app)
      .put(path(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(res.status).toBe(403);

    // and nothing was written
    const rows = await db
      .select()
      .from(brandSalesEconomics)
      .where(eq(brandSalesEconomics.brandId, foreignBrandId));
    expect(rows.length).toBe(0);
  });

  // AC5 — cross-org GET rejected
  it('GET for a brand owned by another org is rejected with 403', async () => {
    const res = await request(app).get(path(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(403);
  });

  // AC6 — unknown brand is 404 (distinct from unset)
  it('GET an unknown brand returns 404', async () => {
    const res = await request(app).get(path(unknownBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(404);
  });

  it('PUT an unknown brand returns 404', async () => {
    const res = await request(app)
      .put(path(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);
    expect(res.status).toBe(404);
  });

  // AC7 — missing field fails loud
  it('PUT with a missing metric field returns 400', async () => {
    const { visitToClosePct, ...incomplete } = validMetrics;
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(incomplete);
    expect(res.status).toBe(400);
  });

  // AC8 — out-of-range percentage fails loud
  it('PUT with a percentage > 100 returns 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, replyToMeetingPct: 150 });
    expect(res.status).toBe(400);
  });

  // AC9 — non-integer value fails loud (no silent coerce)
  it('PUT with a non-integer value returns 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, meetingToClosePct: 12.5 });
    expect(res.status).toBe(400);
  });

  it('PUT with a string value (no coercion) returns 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, lifetimeRevenueUsd: '4000' });
    expect(res.status).toBe(400);
  });

  // AC10 — malformed brand id
  it('GET with a non-UUID brand id returns 400', async () => {
    const res = await request(app).get(path('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(400);
  });

  // AC11 — auth
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(path(brandId));
    expect(res.status).toBe(401);
  });
});
