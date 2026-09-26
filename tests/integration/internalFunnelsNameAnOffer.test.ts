import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandOffers,
  brandSalesFunnels,
  brandSalesFunnelArrowRates,
} from '../../src/db';

/**
 * THE ONE FUNNEL-KEYED READ THAT SURVIVES wave C2:
 * `GET /internal/offers/:offerId/sales-funnels`.
 *
 * Nothing writes `brand_sales_funnels` / `brand_sales_funnel_arrow_rates` any
 * more — every funnel route and writer was deleted — so these rows are seeded
 * directly, exactly as the frozen production rows sit. The read must list the
 * ACTIVE funnels of THAT offer only, in the same shape its two remaining callers
 * (client-service reward-tasks, workflow-service's meeting-booking DAG) consume.
 */
describe('retained internal offer sales-funnels read', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const brandId = randomUUID();
  const brandIds = [brandId];

  let starterOfferId = '';
  let enterpriseOfferId = '';
  let emptyOfferId = '';

  const path = (offerId: string) => `/internal/offers/${offerId}/sales-funnels`;

  beforeAll(async () => {
    await db.insert(brands).values({
      id: brandId,
      url: `https://funnelread-${brandId.slice(0, 8)}.com`,
      domain: `funnelread-${brandId.slice(0, 8)}.com`,
      name: 'Funnel Read Brand',
    });
    await db.insert(orgBrands).values({ orgId, brandId });

    const [starter] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Starter Plan' })
      .returning();
    const [enterprise] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Enterprise' })
      .returning();
    const [empty] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Nothing Stated' })
      .returning();
    starterOfferId = starter.id;
    enterpriseOfferId = enterprise.id;
    emptyOfferId = empty.id;

    await db.insert(brandSalesFunnels).values([
      // Starter: one ACTIVE funnel and one switched OFF.
      {
        orgId,
        brandId,
        offerId: starterOfferId,
        funnelKey: 'website_purchases',
        active: true,
        lifetimeRevenueUsd: 200,
        visitToSignupPct: 8.4,
        signupToPaidClientPct: 20,
        destinationUrl: 'https://example.com/pricing',
      },
      {
        orgId,
        brandId,
        offerId: starterOfferId,
        funnelKey: 'form_magnet',
        active: false,
        lifetimeRevenueUsd: 50,
      },
      // Enterprise: its own funnel, its own price.
      {
        orgId,
        brandId,
        offerId: enterpriseOfferId,
        funnelKey: 'sales_meetings_from_conversation',
        active: true,
        lifetimeRevenueUsd: 20000,
        replyToMeetingPct: 70,
        bookingUrl: 'https://cal.example.com/enterprise',
      },
      // The empty offer only has a switched-off funnel.
      {
        orgId,
        brandId,
        offerId: emptyOfferId,
        funnelKey: 'website_purchases',
        active: false,
      },
    ]);

    // A stated arrow wins over the named column for the same leg.
    await db.insert(brandSalesFunnelArrowRates).values({
      orgId,
      brandId,
      offerId: starterOfferId,
      funnelKey: 'website_purchases',
      fromStep: 'Website visit',
      toStep: 'Signup',
      ratePct: 9,
    });
  });

  afterAll(async () => {
    await db.delete(brandSalesFunnelArrowRates).where(inArray(brandSalesFunnelArrowRates.brandId, brandIds));
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, brandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, brandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, brandIds));
    await db.delete(brands).where(inArray(brands.id, brandIds));
  });

  it('lists only the ACTIVE funnels of THAT offer, in the unchanged shape', async () => {
    const res = await request(app).get(path(starterOfferId)).set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['funnels']);
    // The switched-off form_magnet row is not listed; the sibling offer's
    // funnel is not listed.
    expect(res.body.funnels).toHaveLength(1);

    const [funnel] = res.body.funnels;
    expect(Object.keys(funnel).sort()).toEqual(
      [
        'active',
        'arrows',
        'bookingUrl',
        'destinationUrl',
        'funnelKey',
        'lifetimeRevenueUsd',
        'milestoneStep',
        'milestoneStepIndex',
        'name',
        'rates',
        'startEvent',
        'steps',
        'updatedAt',
      ].sort()
    );
    expect(funnel).toMatchObject({
      funnelKey: 'website_purchases',
      active: true,
      steps: ['Website visit', 'Signup', 'Paid client'],
      startEvent: 'website_visit',
      rates: { visitToSignupPct: 8.4, signupToPaidClientPct: 20 },
      lifetimeRevenueUsd: 200,
      destinationUrl: 'https://example.com/pricing',
      bookingUrl: null,
    });
    expect(typeof funnel.name).toBe('string');
    expect(funnel.steps[funnel.milestoneStepIndex]).toBe(funnel.milestoneStep);
    expect(typeof funnel.updatedAt).toBe('string');
    expect(funnel.arrows).toEqual([
      {
        fromStep: 'Website visit',
        toStep: 'Signup',
        ratePct: 9,
        provenance: 'stated_arrow',
        rateKey: 'visitToSignupPct',
      },
      {
        fromStep: 'Signup',
        toStep: 'Paid client',
        ratePct: 20,
        provenance: 'named_rate',
        rateKey: 'signupToPaidClientPct',
      },
    ]);
  });

  it("serves each offer's OWN funnels and price, never a sibling's", async () => {
    const res = await request(app).get(path(enterpriseOfferId)).set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.funnels).toHaveLength(1);
    expect(res.body.funnels[0]).toMatchObject({
      funnelKey: 'sales_meetings_from_conversation',
      lifetimeRevenueUsd: 20000,
      bookingUrl: 'https://cal.example.com/enterprise',
    });
    expect(res.body.funnels[0].rates.replyToMeetingPct).toBe(70);
  });

  it('answers an empty set for an offer whose only funnel is switched off', async () => {
    const res = await request(app).get(path(emptyOfferId)).set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ funnels: [] });
  });

  it('404s an offer id that names no offer', async () => {
    const res = await request(app).get(path(randomUUID())).set(getInternalAuthHeaders());
    expect(res.status).toBe(404);
  });

  it('400s a malformed offer id', async () => {
    const res = await request(app).get(path('not-a-uuid')).set(getInternalAuthHeaders());
    expect(res.status).toBe(400);
  });
});
