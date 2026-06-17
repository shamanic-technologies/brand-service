import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
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
  const bmBrandId = randomUUID(); // owned by ownerOrgId, business-model lifecycle
  const funnelBrandId = randomUUID(); // owned by ownerOrgId, funnel-fields lifecycle
  const funnelUnsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const defaultsBrandId = randomUUID(); // owned by ownerOrgId, row written WITHOUT the two sub-rates (DB defaults)
  const fractionalBrandId = randomUUID(); // owned by ownerOrgId, fractional percentages
  const allBrandIds = [
    brandId,
    unsetBrandId,
    foreignBrandId,
    bmBrandId,
    funnelBrandId,
    funnelUnsetBrandId,
    defaultsBrandId,
    fractionalBrandId,
  ];

  // visitToSignupPct 40 * signupToPaidClientPct 25 / 100 = 10 (derived visitToClosePct)
  const validMetrics = {
    lifetimeRevenueUsd: 4000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 12,
    meetingToClosePct: 25,
    visitToSignupPct: 40,
    signupToPaidClientPct: 25,
  };
  // Fractional sales rates below 1% are valid user inputs. Derived
  // visitToClosePct must use decimal math: 0.5 * 12.5 / 100 = 0.0625.
  const fractionalMetrics = {
    lifetimeRevenueUsd: 4000,
    replyToMeetingPct: 30.5,
    visitToMeetingPct: 0.75,
    meetingToClosePct: 12.25,
    visitToSignupPct: 0.5,
    signupToPaidClientPct: 12.5,
  };

  beforeAll(async () => {
    await db.insert(brands).values(
      allBrandIds.map((id) => ({
        id,
        url: `https://sales-econ-${id.slice(0, 8)}.com`,
        domain: `sales-econ-${id.slice(0, 8)}.com`,
        name: 'Sales Econ Test Brand',
      }))
    );
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId },
      { orgId: ownerOrgId, brandId: unsetBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
      { orgId: ownerOrgId, brandId: bmBrandId },
      { orgId: ownerOrgId, brandId: funnelBrandId },
      { orgId: ownerOrgId, brandId: funnelUnsetBrandId },
      { orgId: ownerOrgId, brandId: defaultsBrandId },
      { orgId: ownerOrgId, brandId: fractionalBrandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandSalesEconomics).where(inArray(brandSalesEconomics.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const path = (id: string) => `/orgs/brands/${id}/sales-economics`;

  // AC2 — unset returns null, not an error
  it('GET an owned brand with nothing saved returns { salesEconomics: null }, 200', async () => {
    const res = await request(app).get(path(unsetBrandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesEconomics: null });
  });

  // AC1 — PUT then GET round-trips the exact values + derives visitToClosePct
  it('PUT metrics then GET returns exactly those values + derived visitToClosePct + updatedAt', async () => {
    const putRes = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics).toMatchObject(validMetrics);
    // derived = 40 * 25 / 100 = 10, never null, never sent on the request
    expect(putRes.body.salesEconomics.visitToClosePct).toBe(10);
    expect(typeof putRes.body.salesEconomics.updatedAt).toBe('string');

    const getRes = await request(app).get(path(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(getRes.status).toBe(200);
    expect(getRes.body.salesEconomics).toMatchObject(validMetrics);
    expect(getRes.body.salesEconomics.visitToClosePct).toBe(10);
    expect(typeof getRes.body.salesEconomics.updatedAt).toBe('string');
  });

  it('PUT then GET preserves fractional percent values below 1%', async () => {
    const putRes = await request(app)
      .put(path(fractionalBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(fractionalMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics).toMatchObject(fractionalMetrics);
    expect(putRes.body.salesEconomics.visitToClosePct).toBe(0.0625);
    expect(typeof putRes.body.salesEconomics.updatedAt).toBe('string');

    const getRes = await request(app).get(path(fractionalBrandId)).set(getAuthHeaders(ownerOrgId));

    expect(getRes.status).toBe(200);
    expect(getRes.body.salesEconomics).toMatchObject(fractionalMetrics);
    expect(getRes.body.salesEconomics.visitToClosePct).toBe(0.0625);
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
    const { visitToSignupPct, ...incomplete } = validMetrics;
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(incomplete);
    expect(res.status).toBe(400);
  });

  it('PUT with a missing signupToPaidClientPct returns 400', async () => {
    const { signupToPaidClientPct, ...incomplete } = validMetrics;
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

  // AC9 — decimal percentage values are accepted, but no string coercion.
  it('PUT with a fractional percentage value is accepted', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, meetingToClosePct: 12.5 });
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.meetingToClosePct).toBe(12.5);
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

  // ── businessModel (brand-level B2C/B2B) ──────────────────────────
  // Lifecycle runs IN ORDER on bmBrandId: fresh → set → preserve → clear.

  // Fresh brand: legacy 5-field PUT stores businessModel as null (never set)
  it('PUT 5 metrics with no businessModel on a fresh brand → businessModel null', async () => {
    const putRes = await request(app)
      .put(path(bmBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.businessModel).toBeNull();

    const getRes = await request(app).get(path(bmBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.salesEconomics.businessModel).toBeNull();
  });

  // Set businessModel explicitly, round-trips through GET
  it('PUT with businessModel "b2b" → GET returns "b2b"', async () => {
    const putRes = await request(app)
      .put(path(bmBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, businessModel: 'b2b' });

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.businessModel).toBe('b2b');

    const getRes = await request(app).get(path(bmBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.salesEconomics.businessModel).toBe('b2b');
  });

  // Back-compat: a 5-field PUT (no businessModel) must NOT wipe the stored value
  it('PUT 5 metrics with no businessModel preserves the stored "b2b"', async () => {
    const putRes = await request(app)
      .put(path(bmBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.businessModel).toBe('b2b');
  });

  // Explicit null clears it
  it('PUT with businessModel null clears it back to null', async () => {
    const putRes = await request(app)
      .put(path(bmBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, businessModel: null });

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.businessModel).toBeNull();
  });

  // Invalid enum fails loud
  it('PUT with an unknown businessModel returns 400', async () => {
    const res = await request(app)
      .put(path(bmBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, businessModel: 'enterprise' });
    expect(res.status).toBe(400);
  });

  // ── funnelStages + optimizationGoal (sales-funnel config) ─────────
  // Lifecycle runs IN ORDER on funnelBrandId: set → preserve → clear-to-[].

  // AC2 — a brand that never set these reads [] + "sales" (server defaults)
  it('GET a brand that never set funnel fields → funnelStages [] + optimizationGoal "sales"', async () => {
    const putRes = await request(app)
      .put(path(funnelUnsetBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.funnelStages).toEqual([]);
    expect(putRes.body.salesEconomics.optimizationGoal).toBe('sales');

    const getRes = await request(app)
      .get(path(funnelUnsetBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.salesEconomics.funnelStages).toEqual([]);
    expect(getRes.body.salesEconomics.optimizationGoal).toBe('sales');
  });

  // AC1 — PUT both fields then GET round-trips exactly
  it('PUT funnelStages + optimizationGoal → GET returns them exactly', async () => {
    const putRes = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({
        ...validMetrics,
        funnelStages: ['website_purchase', 'sales_meeting'],
        optimizationGoal: 'booked_meetings',
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.funnelStages).toEqual([
      'website_purchase',
      'sales_meeting',
    ]);
    expect(putRes.body.salesEconomics.optimizationGoal).toBe('booked_meetings');

    const getRes = await request(app)
      .get(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.salesEconomics.funnelStages).toEqual([
      'website_purchase',
      'sales_meeting',
    ]);
    expect(getRes.body.salesEconomics.optimizationGoal).toBe('booked_meetings');
  });

  // AC3 — omitting both keys leaves prior values unchanged (idempotent)
  it('PUT 5 metrics with no funnel fields preserves stored funnelStages + optimizationGoal', async () => {
    const putRes = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send(validMetrics);

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.funnelStages).toEqual([
      'website_purchase',
      'sales_meeting',
    ]);
    expect(putRes.body.salesEconomics.optimizationGoal).toBe('booked_meetings');
  });

  // Sending [] explicitly clears funnelStages (distinct from omitting)
  it('PUT funnelStages [] sets it to empty (not unchanged)', async () => {
    const putRes = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, funnelStages: [] });

    expect(putRes.status).toBe(200);
    expect(putRes.body.salesEconomics.funnelStages).toEqual([]);
    // optimizationGoal omitted → preserved
    expect(putRes.body.salesEconomics.optimizationGoal).toBe('booked_meetings');
  });

  // AC4 — invalid funnelStages value fails loud, no write
  it('PUT with an unknown funnelStages value returns 400', async () => {
    const res = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, funnelStages: ['website_purchase', 'bogus_stage'] });
    expect(res.status).toBe(400);
  });

  // AC4 — funnelStages must be an array
  it('PUT with funnelStages as a non-array returns 400', async () => {
    const res = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, funnelStages: 'website_purchase' });
    expect(res.status).toBe(400);
  });

  // AC4 — invalid optimizationGoal fails loud
  it('PUT with an unknown optimizationGoal returns 400', async () => {
    const res = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, optimizationGoal: 'revenue' });
    expect(res.status).toBe(400);
  });

  // ── split self-serve close (visit→signup, signup→paid) ───────────

  // AC5 — funnelStages 'website_signup' (dropped) is rejected; valid values accepted
  it('PUT funnelStages "website_signup" (dropped) returns 400', async () => {
    const res = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, funnelStages: ['website_signup'] });
    expect(res.status).toBe(400);
  });

  it('PUT funnelStages [website_purchase, sales_meeting] is accepted', async () => {
    const res = await request(app)
      .put(path(funnelBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...validMetrics, funnelStages: ['website_purchase', 'sales_meeting'] });
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.funnelStages).toEqual(['website_purchase', 'sales_meeting']);
  });

  // AC2 — a legacy PUT still sending visitToClosePct does not corrupt state;
  // the two sub-rates are the source of truth, visitToClosePct is derived.
  it('PUT that also sends a legacy visitToClosePct ignores it (derives from sub-rates)', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      // visitToClosePct: 99 is a stale legacy value; must be ignored
      .send({ ...validMetrics, visitToClosePct: 99 });

    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.visitToSignupPct).toBe(40);
    expect(res.body.salesEconomics.signupToPaidClientPct).toBe(25);
    // derived from the sub-rates, NOT the 99 that was sent
    expect(res.body.salesEconomics.visitToClosePct).toBe(10);
  });

  // AC4 — fresh-brand defaults: a row inserted WITHOUT the two sub-rates reads
  // visitToSignupPct=25, signupToPaidClientPct=20 (DB defaults) → visitToClosePct=5.
  it('a row written without the sub-rates reads the 25/20 defaults → visitToClosePct 5', async () => {
    // Insert directly omitting visit_to_signup_pct + signup_to_paid_client_pct so
    // the DB column defaults apply. visit_to_close_pct is required (no default);
    // set it to a stale value to prove the response derives, not reads it.
    await db.insert(brandSalesEconomics).values({
      brandId: defaultsBrandId,
      lifetimeRevenueUsd: 1000,
      replyToMeetingPct: 10,
      visitToMeetingPct: 8,
      meetingToClosePct: 20,
      visitToClosePct: 77,
    } as any);

    const res = await request(app).get(path(defaultsBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.visitToSignupPct).toBe(25);
    expect(res.body.salesEconomics.signupToPaidClientPct).toBe(20);
    // derived = 25 * 20 / 100 = 5, NOT the stale 77
    expect(res.body.salesEconomics.visitToClosePct).toBe(5);
  });
});
