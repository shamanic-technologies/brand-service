import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandOffers,
  brandLegRates,
} from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * The funnel is retired: a brand states a conversion rate per (org, brand, LEG)
 * and a lifetime revenue per OFFER, with no funnel in the request. The last
 * funnel-keyed read (`GET /internal/offers/:offerId/sales-funnels`) was deleted
 * in wave C3 with the frozen tables it read, so it is gone (404).
 */
describe('Leg-grain rates and per-offer lifetime revenue', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrg = randomUUID();
  const brandId = randomUUID();
  const sharedBrandId = randomUUID();
  const domain = `legs-${brandId.slice(0, 8)}.com`;
  const legs = `/orgs/brands/${brandId}/leg-rates`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const leg = (body: any, from: string, to: string) =>
    body.legRates.find((l: any) => l.fromStep === from && l.toStep === to);

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${domain}`, domain, name: 'Legs Brand' },
      { id: sharedBrandId, url: `https://s${domain}`, domain: `s${domain}`, name: 'Shared' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: sharedBrandId },
      { orgId: otherOrg, brandId: sharedBrandId },
    ]);
    const [a] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Self Serve' }).returning();
    const [b] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Enterprise' }).returning();
    offerA = a.id;
    offerB = b.id;
  });

  afterAll(async () => {
    const ids = [brandId, sharedBrandId];
    await db.delete(brandLegRates).where(inArray(brandLegRates.brandId, ids));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, ids));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, ids));
    await db.delete(brands).where(inArray(brands.id, ids));
  });

  it('lists every catalogue leg once, unstated, never a number', async () => {
    const res = await request(app).get(legs).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    const ids = res.body.legRates.map((l: any) => `${l.fromStep}>${l.toStep}`);
    expect(new Set(ids).size).toBe(ids.length);
    // Meeting booked -> Meeting attended sits in several funnels and is listed ONCE.
    expect(ids.filter((i: string) => i === 'Meeting booked>Meeting attended')).toHaveLength(1);
    expect(leg(res.body, 'Positive reply', 'Meeting booked')).toEqual({
      fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: null, stated: false, statedAt: null,
    });
  });

  it('AC: a leg rate written for an offer reads back with no funnel involved', async () => {
    const put = await request(app)
      .put(`${offersPath}/${offerA}/economics`)
      .set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 20 }] });
    expect(put.status).toBe(200);
    expect(leg(put.body, 'Positive reply', 'Meeting booked')).toMatchObject({ ratePct: 20, stated: true });

    const read = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId));
    expect(read.status).toBe(200);
    expect(leg(read.body, 'Positive reply', 'Meeting booked').ratePct).toBe(20);
    // Shared by every offer of the brand.
    const sibling = await request(app).get(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId));
    expect(leg(sibling.body, 'Positive reply', 'Meeting booked').ratePct).toBe(20);
    const brandRead = await request(app).get(legs).set(getAuthHeaders(orgId));
    expect(leg(brandRead.body, 'Positive reply', 'Meeting booked').ratePct).toBe(20);

  });

  it('writes and clears through the brand leg route', async () => {
    const put = await request(app)
      .put(legs)
      .set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Meeting booked', toStep: 'Meeting attended', ratePct: 60 }] });
    expect(put.status).toBe(200);
    expect(leg(put.body, 'Meeting booked', 'Meeting attended')).toMatchObject({ ratePct: 60, stated: true });

    const clear = await request(app)
      .put(legs)
      .set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Meeting booked', toStep: 'Meeting attended', ratePct: null }] });
    expect(leg(clear.body, 'Meeting booked', 'Meeting attended')).toMatchObject({ ratePct: null, stated: false });
  });

  it('refuses a malformed leg write with nothing stored', async () => {
    const dup = await request(app).put(legs).set(getAuthHeaders(orgId)).send({ legRates: [
      { fromStep: 'Signup', toStep: 'Paid client', ratePct: 1 },
      { fromStep: 'Signup', toStep: 'Paid client', ratePct: 2 },
    ] });
    expect(dup.status).toBe(400);
    const self = await request(app).put(legs).set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Signup', toStep: 'Signup', ratePct: 1 }] });
    expect(self.status).toBe(400);
    const range = await request(app).put(legs).set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Signup', toStep: 'Paid client', ratePct: 101 }] });
    expect(range.status).toBe(400);
    const empty = await request(app).put(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId)).send({});
    expect(empty.status).toBe(400);
    const negative = await request(app).put(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: -5 });
    expect(negative.status).toBe(400);
    const rows = await db.select().from(brandLegRates).where(eq(brandLegRates.toStep, 'Paid client'));
    expect(rows.filter((r) => r.brandId === brandId)).toHaveLength(0);
  });

  it('a lifetime revenue is stated per OFFER', async () => {
    const put = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 20000 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ offerId: offerB, name: 'Enterprise', lifetimeRevenueUsd: 20000 });
    expect(put.body.lifetimeRevenueStatedAt).not.toBeNull();

    const a = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId));
    expect(a.body.lifetimeRevenueUsd).toBeNull();
    expect(a.body.lifetimeRevenueStatedAt).toBeNull();

    const clear = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: null });
    expect(clear.body).toMatchObject({ lifetimeRevenueUsd: null, lifetimeRevenueStatedAt: null });
  });

  it('internal reads: no user needed, org resolved or ORG_REQUIRED, offers listed', async () => {
    const stated = await request(app).put(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 900 });
    expect(stated.status).toBe(200);

    const one = await request(app).get(`/internal/brands/${brandId}/offer-economics`).set(getInternalAuthHeaders());
    expect(one.status).toBe(200);
    expect(one.body.offers.map((o: any) => o.offerId)).toEqual([offerA, offerB]);
    expect(one.body.offers[0].lifetimeRevenueUsd).toBe(900);
    expect(leg(one.body, 'Positive reply', 'Meeting booked').ratePct).toBe(20);

    const legRead = await request(app).get(`/internal/brands/${brandId}/leg-rates`).set(getInternalAuthHeaders());
    expect(leg(legRead.body, 'Positive reply', 'Meeting booked').ratePct).toBe(20);

    const offer = await request(app).get(`/internal/brands/${brandId}/offers/${offerA}/economics`).set(getInternalAuthHeaders());
    expect(offer.status).toBe(200);
    expect(offer.body.lifetimeRevenueUsd).toBe(900);

    const shared = await request(app).get(`/internal/brands/${sharedBrandId}/leg-rates`).set(getInternalAuthHeaders());
    expect(shared.status).toBe(400);
    expect(shared.body.code).toBe('ORG_REQUIRED');

    const missing = await request(app).get(`/internal/brands/${brandId}/offers/${randomUUID()}/economics`).set(getInternalAuthHeaders());
    expect(missing.status).toBe(404);
    const foreign = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(otherOrg));
    expect(foreign.status).toBe(403);
  });

  it('an offer states its booking link and click destination, read back by offer id alone', async () => {
    const put = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ bookingUrl: 'https://calendly.com/acme/intro', destinationUrl: 'https://legs.example/pricing' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      offerId: offerB, bookingUrl: 'https://calendly.com/acme/intro', destinationUrl: 'https://legs.example/pricing',
    });

    // The other offer of the same brand is untouched.
    const a = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId));
    expect(a.body).toMatchObject({ bookingUrl: null, destinationUrl: null });

    const byOffer = await request(app).get(`/internal/offers/${offerB}/economics`).set(getInternalAuthHeaders());
    expect(byOffer.status).toBe(200);
    expect(byOffer.body).toMatchObject({ offerId: offerB, bookingUrl: 'https://calendly.com/acme/intro' });
    expect(Array.isArray(byOffer.body.legRates)).toBe(true);

    const listed = await request(app).get(`/internal/brands/${brandId}/offer-economics`).set(getInternalAuthHeaders());
    const row = listed.body.offers.find((o: any) => o.offerId === offerB);
    expect(row).toMatchObject({ bookingUrl: 'https://calendly.com/acme/intro', destinationUrl: 'https://legs.example/pricing' });

    const bad = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ bookingUrl: 'ftp://nope' });
    expect(bad.status).toBe(400);

    const clear = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ bookingUrl: null });
    expect(clear.body).toMatchObject({ bookingUrl: null, destinationUrl: 'https://legs.example/pricing' });

    const missing = await request(app).get(`/internal/offers/${randomUUID()}/economics`).set(getInternalAuthHeaders());
    expect(missing.status).toBe(404);
  });

  it('the retired per-offer funnel read is gone (wave C3)', async () => {
    const res = await request(app).get(`/internal/offers/${offerA}/sales-funnels`).set(getInternalAuthHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error).not.toBe('Offer not found');
  });
});
