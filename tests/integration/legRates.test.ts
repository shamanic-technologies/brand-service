import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandOffers,
  brandSalesFunnels,
  brandSalesFunnelArrowRates,
  brandFunnelArrowRates,
  brandLegRates,
} from '../../src/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * The funnel is being retired: a brand states a conversion rate per (org, brand,
 * LEG) and a lifetime revenue per OFFER, with no funnel in the request. The
 * funnel-keyed routes keep answering byte for byte.
 */
describe('Leg-grain rates and per-offer lifetime revenue', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrg = randomUUID();
  const brandId = randomUUID();
  const sharedBrandId = randomUUID();
  const carryBrandId = randomUUID();
  const domain = `legs-${brandId.slice(0, 8)}.com`;
  const KEY = 'sales_meetings_from_conversation';
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
      { id: carryBrandId, url: `https://c${domain}`, domain: `c${domain}`, name: 'Carry' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: sharedBrandId },
      { orgId: otherOrg, brandId: sharedBrandId },
      { orgId, brandId: carryBrandId },
    ]);
    const [a] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Self Serve' }).returning();
    const [b] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Enterprise' }).returning();
    offerA = a.id;
    offerB = b.id;
  });

  afterAll(async () => {
    const ids = [brandId, sharedBrandId, carryBrandId];
    await db.delete(brandLegRates).where(inArray(brandLegRates.brandId, ids));
    await db.delete(brandFunnelArrowRates).where(inArray(brandFunnelArrowRates.brandId, ids));
    await db.delete(brandSalesFunnelArrowRates).where(inArray(brandSalesFunnelArrowRates.brandId, ids));
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, ids));
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

  it('AC: a leg rate written for an offer reads back with no funnel involved, and moves no funnel-keyed read', async () => {
    const funnelBefore = await request(app).get(`/orgs/brands/${brandId}/funnel-rates`).set(getAuthHeaders(orgId));
    const offerFunnelsBefore = await request(app).get(`${offersPath}/${offerA}/sales-funnels`).set(getAuthHeaders(orgId));

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

    const funnelAfter = await request(app).get(`/orgs/brands/${brandId}/funnel-rates`).set(getAuthHeaders(orgId));
    const offerFunnelsAfter = await request(app).get(`${offersPath}/${offerA}/sales-funnels`).set(getAuthHeaders(orgId));
    expect(funnelAfter.body).toEqual(funnelBefore.body);
    expect(offerFunnelsAfter.status).toBe(offerFunnelsBefore.status);
    expect(offerFunnelsAfter.body).toEqual(offerFunnelsBefore.body);
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

  it('a lifetime revenue is stated per OFFER and moves no funnel-keyed read', async () => {
    const before = await request(app).get(`${offersPath}/${offerB}/sales-funnels`).set(getAuthHeaders(orgId));
    const put = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 20000 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ offerId: offerB, name: 'Enterprise', lifetimeRevenueUsd: 20000 });
    expect(put.body.lifetimeRevenueStatedAt).not.toBeNull();

    const a = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId));
    expect(a.body.lifetimeRevenueUsd).toBeNull();
    expect(a.body.lifetimeRevenueStatedAt).toBeNull();

    const after = await request(app).get(`${offersPath}/${offerB}/sales-funnels`).set(getAuthHeaders(orgId));
    expect(after.body).toEqual(before.body);

    const clear = await request(app).put(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: null });
    expect(clear.body).toMatchObject({ lifetimeRevenueUsd: null, lifetimeRevenueStatedAt: null });
  });

  it('PRECEDENCE: a brand-grain funnel-rate write is the leg\'s latest statement; a later leg write wins; a funnel null does not clear the leg', async () => {
    const funnelPut = await request(app)
      .put(`/orgs/brands/${brandId}/funnel-rates/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Meeting attended', toStep: 'Paid client', ratePct: 25 }] });
    expect(funnelPut.status).toBe(200);
    let read = await request(app).get(legs).set(getAuthHeaders(orgId));
    expect(leg(read.body, 'Meeting attended', 'Paid client').ratePct).toBe(25);

    await request(app).put(legs).set(getAuthHeaders(orgId))
      .send({ legRates: [{ fromStep: 'Meeting attended', toStep: 'Paid client', ratePct: 40 }] });
    read = await request(app).get(legs).set(getAuthHeaders(orgId));
    expect(leg(read.body, 'Meeting attended', 'Paid client').ratePct).toBe(40);
    // One-way: the funnel-keyed read still answers what was stated there.
    const funnel = await request(app).get(`/orgs/brands/${brandId}/funnel-rates?funnelKey=${KEY}`).set(getAuthHeaders(orgId));
    const arrow = funnel.body.funnels[0].arrows.find((x: any) => x.fromStep === 'Meeting attended' && x.toStep === 'Paid client');
    expect(arrow.ratePct).toBe(25);

    await request(app).put(`/orgs/brands/${brandId}/funnel-rates/${KEY}`).set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Meeting attended', toStep: 'Paid client', ratePct: null }] });
    read = await request(app).get(legs).set(getAuthHeaders(orgId));
    expect(leg(read.body, 'Meeting attended', 'Paid client').ratePct).toBe(40);
  });

  it('PRECEDENCE: a per-offer funnel write carrying a lifetime revenue is the offer\'s latest statement', async () => {
    const put = await request(app)
      .put(`${offersPath}/${offerA}/sales-funnels/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 900 });
    expect(put.status).toBe(200);
    const read = await request(app).get(`${offersPath}/${offerA}/economics`).set(getAuthHeaders(orgId));
    expect(read.body.lifetimeRevenueUsd).toBe(900);
    // The sibling offer is untouched.
    const b = await request(app).get(`${offersPath}/${offerB}/economics`).set(getAuthHeaders(orgId));
    expect(b.body.lifetimeRevenueUsd).toBeNull();
  });

  it('internal reads: no user needed, org resolved or ORG_REQUIRED, offers listed', async () => {
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

  it('CARRY-OVER (migration 0071): most recent funnel statement per leg / per offer wins; never overwrites', async () => {
    const [offer] = await db.insert(brandOffers).values({ orgId, brandId: carryBrandId, name: 'Carry Offer' }).returning();
    const [stated] = await db.insert(brandOffers)
      .values({ orgId, brandId: carryBrandId, name: 'Already Stated', lifetimeRevenueUsd: 7, lifetimeRevenueStatedAt: '2026-09-20T00:00:00Z' })
      .returning();
    await db.insert(brandFunnelArrowRates).values([
      { orgId, brandId: carryBrandId, funnelKey: 'sales_meetings_from_conversation', fromStep: 'Meeting booked', toStep: 'Meeting attended', ratePct: 50, updatedAt: '2026-09-15T00:00:00Z' },
      { orgId, brandId: carryBrandId, funnelKey: 'sales_meetings_from_website', fromStep: 'Meeting booked', toStep: 'Meeting attended', ratePct: 70, updatedAt: '2026-08-16T00:00:00Z' },
      { orgId, brandId: carryBrandId, funnelKey: 'sales_meetings_from_conversation', fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 30, updatedAt: '2026-08-16T00:00:00Z' },
    ]);
    // A leg already stated at the leg grain must survive the carry-over.
    await db.insert(brandLegRates).values({ orgId, brandId: carryBrandId, fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 12 });
    await db.insert(brandSalesFunnels).values([
      { orgId, brandId: carryBrandId, offerId: offer.id, funnelKey: 'website_purchases', lifetimeRevenueUsd: 500, updatedAt: '2026-09-15T09:52:00Z' },
      { orgId, brandId: carryBrandId, offerId: offer.id, funnelKey: 'sales_meetings_from_conversation', lifetimeRevenueUsd: 175, updatedAt: '2026-08-16T10:35:00Z' },
      { orgId, brandId: carryBrandId, offerId: stated.id, funnelKey: 'website_purchases', lifetimeRevenueUsd: 300, updatedAt: '2026-09-21T00:00:00Z' },
    ]);

    const file = fs.readFileSync(path.join(__dirname, '../../drizzle/0071_leg_rates_and_offer_lifetime_revenue.sql'), 'utf8');
    const statements = file.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => /^(INSERT|UPDATE)/.test(s.replace(/^--.*$/gm, '').trim()));
    expect(statements).toHaveLength(2);
    for (const run of [1, 2]) {
      for (const stmt of statements) await db.execute(sql.raw(stmt));
      void run; // idempotent: the second pass changes nothing
    }

    const res = await request(app).get(`/orgs/brands/${carryBrandId}/leg-rates`).set(getAuthHeaders(orgId));
    expect(leg(res.body, 'Meeting booked', 'Meeting attended').ratePct).toBe(50);
    expect(leg(res.body, 'Positive reply', 'Meeting booked').ratePct).toBe(12);

    const a = await request(app).get(`/orgs/brands/${carryBrandId}/offers/${offer.id}/economics`).set(getAuthHeaders(orgId));
    expect(a.body.lifetimeRevenueUsd).toBe(500);
    expect(a.body.lifetimeRevenueStatedAt).toMatch(/^2026-09-15/);
    const s = await request(app).get(`/orgs/brands/${carryBrandId}/offers/${stated.id}/economics`).set(getAuthHeaders(orgId));
    expect(s.body.lifetimeRevenueUsd).toBe(7);

    const rows = await db.select().from(brandLegRates).where(eq(brandLegRates.brandId, carryBrandId));
    expect(rows).toHaveLength(2);
  });
});
