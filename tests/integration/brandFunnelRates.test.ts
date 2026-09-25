import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandOffers,
  brandSalesFunnels,
  brandSalesFunnelArrowRates,
  brandFunnelArrowRates,
} from '../../src/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  applyMigrationPlan,
  readMigrationSources,
} from '../../src/services/brandFunnelRatesService';
import { planBrandRatesMigration } from '../../src/lib/brand-funnel-rates';

/**
 * A brand states ONE conversion rate per (funnel, arrow), shared by every offer
 * of the brand. Lifetime revenue and the booking link stay per offer; the
 * per-offer rates keep answering exactly as before.
 */
describe('Brand-grain funnel rates', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrg = randomUUID();
  const brandId = randomUUID();
  const sharedBrandId = randomUUID();
  const domain = `rates-${brandId.slice(0, 8)}.com`;
  const KEY = 'sales_meetings_from_conversation';
  const base = `/orgs/brands/${brandId}/funnel-rates`;
  const find = (funnel: any, from: string, to: string) =>
    funnel.arrows.find((a: any) => a.fromStep === from && a.toStep === to);

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${domain}`, domain, name: 'Rates Brand' },
      { id: sharedBrandId, url: `https://s${domain}`, domain: `s${domain}`, name: 'Shared Brand' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: sharedBrandId },
      { orgId: otherOrg, brandId: sharedBrandId },
    ]);
  });

  afterAll(async () => {
    const ids = [brandId, sharedBrandId];
    await db.delete(brandFunnelArrowRates).where(inArray(brandFunnelArrowRates.brandId, ids));
    await db.delete(brandSalesFunnelArrowRates).where(inArray(brandSalesFunnelArrowRates.brandId, ids));
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, ids));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, ids));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, ids));
    await db.delete(brands).where(inArray(brands.id, ids));
  });

  it('an arrow the brand never stated reads as not stated, never a number', async () => {
    const res = await request(app).get(base).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    const funnel = res.body.funnels.find((f: any) => f.funnelKey === KEY);
    expect(find(funnel, 'Positive reply', 'Meeting booked')).toEqual({
      fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: null, stated: false, statedAt: null,
    });
  });

  it('writes, reads and clears a rate at the brand grain', async () => {
    const put = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 30 }] });
    expect(put.status).toBe(200);
    expect(find(put.body.funnel, 'Positive reply', 'Meeting booked')).toMatchObject({ ratePct: 30, stated: true });

    const read = await request(app).get(`${base}?funnelKey=${KEY}`).set(getAuthHeaders(orgId));
    expect(read.body.funnels).toHaveLength(1);
    expect(find(read.body.funnels[0], 'Positive reply', 'Meeting booked').ratePct).toBe(30);

    const clear = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: null }] });
    expect(clear.status).toBe(200);
    expect(find(clear.body.funnel, 'Positive reply', 'Meeting booked')).toMatchObject({ ratePct: null, stated: false });
    const rows = await db.select().from(brandFunnelArrowRates).where(eq(brandFunnelArrowRates.brandId, brandId));
    expect(rows).toHaveLength(0);
  });

  it('accepts a legacy funnel spelling and stores the canonical key', async () => {
    const put = await request(app)
      .put(`${base}/reply_meeting`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Meeting attended', toStep: 'Paid client', ratePct: 22 }] });
    expect(put.status).toBe(200);
    expect(put.body.funnel.funnelKey).toBe(KEY);
  });

  it('refuses a malformed write with nothing stored', async () => {
    const dup = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [
        { fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 10 },
        { fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 11 },
      ] });
    expect(dup.status).toBe(400);
    const self = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'X', toStep: 'X', ratePct: 10 }] });
    expect(self.status).toBe(400);
    const range = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'A', toStep: 'B', ratePct: 140 }] });
    expect(range.status).toBe(400);
    const unknown = await request(app).put(`${base}/nope`).set(getAuthHeaders(orgId)).send({ arrowRates: [{ fromStep: 'A', toStep: 'B', ratePct: 1 }] });
    expect(unknown.status).toBe(400);
    const stored = await db.select().from(brandFunnelArrowRates)
      .where(and(eq(brandFunnelArrowRates.brandId, brandId), eq(brandFunnelArrowRates.fromStep, 'Positive reply')));
    expect(stored).toHaveLength(0);
  });

  it('another org cannot write this brand', async () => {
    const res = await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(randomUUID()))
      .send({ arrowRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 10 }] });
    expect(res.status).toBe(403);
  });

  it('the internal read answers with NO user identity, with and without an org', async () => {
    const orgLess = await request(app).get(`/internal/brands/${brandId}/funnel-rates?funnelKey=${KEY}`).set(getInternalAuthHeaders());
    expect(orgLess.status).toBe(200);
    expect(find(orgLess.body.funnels[0], 'Meeting attended', 'Paid client').ratePct).toBe(22);

    const withOrg = await request(app)
      .get(`/internal/brands/${brandId}/funnel-rates`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', orgId);
    expect(withOrg.status).toBe(200);
    expect(withOrg.body.funnels.length).toBeGreaterThan(1);

    const ambiguous = await request(app).get(`/internal/brands/${sharedBrandId}/funnel-rates`).set(getInternalAuthHeaders());
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.code).toBe('ORG_REQUIRED');

    const unclaimed = await request(app).get(`/internal/brands/${randomUUID()}/funnel-rates`).set(getInternalAuthHeaders());
    expect(unclaimed.status).toBe(200);
    expect(unclaimed.body.funnels.every((f: any) => f.arrows.every((a: any) => a.stated === false))).toBe(true);
  });

  it('the per-offer funnel read is unchanged by a brand-grain rate', async () => {
    const declare = await request(app)
      .put(`/orgs/brands/${brandId}/sales-funnels/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ rates: { replyToMeetingPct: 12 } });
    expect(declare.status).toBe(200);
    await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 55 }] });
    const perOffer = await request(app).get(`/orgs/brands/${brandId}/sales-funnels`).set(getAuthHeaders(orgId));
    const funnel = perOffer.body.funnels.find((f: any) => f.funnelKey === KEY);
    expect(funnel.rates.replyToMeetingPct).toBe(12);
  });

  it('the migration moves a per-offer rate up, never overwrites a brand statement, and is idempotent', async () => {
    // Rates Brand: brand-grain already states Positive reply -> Meeting booked = 55
    // (previous test); its offer states 12 there. The migration must not overwrite.
    const [offer] = await db.select().from(brandOffers).where(eq(brandOffers.brandId, brandId));
    await db.update(brandSalesFunnels)
      .set({ meetingToClosePct: 33 })
      .where(and(eq(brandSalesFunnels.offerId, offer.id), eq(brandSalesFunnels.funnelKey, KEY)));

    const { funnels, arrows } = await readMigrationSources();
    const mine = (r: { brandId: string }) => r.brandId === brandId;
    const plan = planBrandRatesMigration(funnels.filter(mine), arrows.filter(mine));
    const inserted = await applyMigrationPlan(plan);
    // Meeting attended -> Paid client already stated (22), Positive reply already
    // stated (55): nothing new except... none of the funnel's arrows is unstated
    // AND priced, so zero inserts.
    expect(inserted).toBe(0);

    await db.delete(brandFunnelArrowRates).where(eq(brandFunnelArrowRates.brandId, brandId));
    const again = await applyMigrationPlan(plan);
    expect(again).toBe(2);
    const rows = await db.select().from(brandFunnelArrowRates).where(eq(brandFunnelArrowRates.brandId, brandId));
    expect(rows.map((r) => [r.fromStep, r.toStep, Number(r.ratePct)]).sort()).toEqual(
      [['Meeting attended', 'Paid client', 33], ['Positive reply', 'Meeting booked', 12]].sort()
    );
    expect(rows.every((r) => r.migratedFromOfferId === offer.id && r.migratedAt !== null)).toBe(true);
    expect(await applyMigrationPlan(plan)).toBe(0);

    // Restating a migrated rate makes it the caller's.
    await request(app)
      .put(`${base}/${KEY}`)
      .set(getAuthHeaders(orgId))
      .send({ arrowRates: [{ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 13 }] });
    const restated = await db.select().from(brandFunnelArrowRates).where(
      and(eq(brandFunnelArrowRates.brandId, brandId), isNull(brandFunnelArrowRates.migratedAt))
    );
    expect(restated.map((r) => r.fromStep)).toEqual(['Positive reply']);
  });
});
