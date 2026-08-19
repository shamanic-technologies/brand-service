import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandSalesFunnels, brandUserFields } from '../../src/db';

/**
 * SEVERAL ORGS CLAIMING ONE BRAND EACH HOLD THEIR OWN OFFER — and those rows are
 * not duplicates of each other.
 *
 * `brands` is the global silver identity: 21 production brands are claimed by
 * more than one org, one of them by ten. `brand_offers` is per-`(org, brand)`
 * config like every other table a customer configures, so a brand ten orgs claim
 * carries TEN offer rows — commonly with the same or a near-identical name,
 * because they were each named from the same brand by the same prompt, seconds
 * apart, in one pass of the one-time migration.
 *
 * Read as a flat table those rows look exactly like clones of one proposition,
 * and the repair that suggests itself — merge them onto one survivor — would
 * delete nine orgs' configuration and repoint their campaigns onto a tenth org's
 * row. That is the leak migration `0050` closed, reopened as data loss.
 *
 * These tests pin what makes the rows correct instead: every write, every read
 * and every resolution is org-scoped, so each org sees exactly ONE offer for the
 * brand and never another org's. A change that collapses them across orgs fails
 * here.
 */
describe('offers on a brand several orgs claim', () => {
  const app = createTestApp();

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgC = randomUUID();
  const brandId = randomUUID();

  // The same name each org's offer gets — the production shape, where one brand
  // carries six rows all called "Press Coverage".
  const SHARED_NAME = 'Press Coverage';

  const offersPath = `/orgs/brands/${brandId}/offers`;
  const offerIds: Record<string, string> = {};

  beforeAll(async () => {
    await db.insert(brands).values({
      id: brandId,
      url: `https://shared-${brandId.slice(0, 8)}.com`,
      domain: `shared-${brandId.slice(0, 8)}.com`,
      name: 'Shared Brand',
    });
    await db.insert(orgBrands).values([
      { orgId: orgA, brandId },
      { orgId: orgB, brandId },
      { orgId: orgC, brandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, [brandId]));
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, [brandId]));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  });

  it('lets every org create its OWN offer under the same name — the name is unique per org, not per brand', async () => {
    for (const orgId of [orgA, orgB, orgC]) {
      const res = await request(app)
        .post(offersPath)
        .set(getAuthHeaders(orgId))
        .send({ name: SHARED_NAME });

      expect(res.status).toBe(201);
      expect(res.body.offer.name).toBe(SHARED_NAME);
      offerIds[orgId] = res.body.offer.offerId;
    }

    // Three rows, one proposition each, three distinct ids. Three orgs, not three
    // clones.
    expect(new Set(Object.values(offerIds)).size).toBe(3);
  });

  it('shows each org exactly ONE offer — its own, never the other two', async () => {
    for (const orgId of [orgA, orgB, orgC]) {
      const res = await request(app).get(offersPath).set(getAuthHeaders(orgId));

      expect(res.status).toBe(200);
      expect(res.body.offers).toHaveLength(1);
      expect(res.body.offers[0].offerId).toBe(offerIds[orgId]);
    }
  });

  it('keeps the BRAND-scoped call answerable: three offers on the brand is still one per org, not "several"', async () => {
    // `resolveSoleOffer` counts the CALLER'S offers. Were it keyed on the brand
    // alone, every org on a multi-claimed brand would get a 409 telling it to
    // name an offer it never created.
    const res = await request(app)
      .get(`/orgs/brands/${brandId}/sales-funnels`)
      .set(getAuthHeaders(orgA));

    expect(res.status).toBe(200);
  });

  it("404s another org's offer id, so no org can read or write the row beside its own", async () => {
    const res = await request(app)
      .get(`${offersPath}/${offerIds[orgB]}`)
      .set(getAuthHeaders(orgA));

    expect(res.status).toBe(404);
  });

  it('prices one org\'s offer without touching the row beside it', async () => {
    const declare = (orgId: string, lifetimeRevenueUsd: number) =>
      request(app)
        .put(
          `${offersPath}/${offerIds[orgId]}/sales-funnels/sales_meetings_from_conversation`
        )
        .set(getAuthHeaders(orgId))
        .send({ lifetimeRevenueUsd });

    expect((await declare(orgA, 1000)).status).toBe(200);
    expect((await declare(orgB, 9000)).status).toBe(200);

    const a = await request(app)
      .get(`${offersPath}/${offerIds[orgA]}/sales-funnels`)
      .set(getAuthHeaders(orgA));
    const b = await request(app)
      .get(`${offersPath}/${offerIds[orgB]}/sales-funnels`)
      .set(getAuthHeaders(orgB));

    expect(a.body.funnels).toHaveLength(1);
    expect(b.body.funnels).toHaveLength(1);
    expect(a.body.funnels[0].lifetimeRevenueUsd).toBe(1000);
    // What a merge onto one survivor would destroy: two orgs, two prices, one
    // brand, and no way to tell afterwards which number belonged to whom.
    expect(b.body.funnels[0].lifetimeRevenueUsd).toBe(9000);
  });

  it('refuses the internal brand-keyed read without an org rather than answering with one org\'s offer', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}/offers`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORG_REQUIRED');
  });

  it('answers the internal read with exactly the named org\'s offer', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}/offers`)
      .set({ ...getInternalAuthHeaders(), 'X-Org-Id': orgC });

    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(1);
    expect(res.body.offers[0].offerId).toBe(offerIds[orgC]);
  });
});
