import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesFunnels } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * The three situations that were undeclarable while cold email was the only
 * channel we ran: the sale that closes inside the conversation, the form hosted
 * by the advertising platform, and the meeting booked straight from an ad.
 *
 * Each is declared, priced and read back exactly as the original four are — and
 * every funnel, old and new, answers the two questions a consumer opening thirty
 * channels has to ask: what event STARTS this, and which of its steps is the
 * MILESTONE a month of that channel has to pay for.
 */
describe('Funnels that start neither in a conversation-with-a-meeting nor on the site', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const brandId = randomUUID(); // has a website
  const noWebsiteBrandId = randomUUID(); // none of the three new funnels needs one

  const domain = `beyond-${brandId.slice(0, 8)}.com`;
  const allBrandIds = [brandId, noWebsiteBrandId];

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${domain}`, domain, name: 'Beyond Brand' },
      { id: noWebsiteBrandId, name: 'Beyond Brand Without A Site' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: noWebsiteBrandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const one = (id: string, key: string) => `/orgs/brands/${id}/sales-funnels/${key}`;
  const list = (id: string) => `/orgs/brands/${id}/sales-funnels`;

  it('declares and prices the sale that closes inside the conversation', async () => {
    const res = await request(app)
      .put(one(brandId, 'sales_from_conversation'))
      .set(getAuthHeaders(orgId))
      .send({
        rates: { replyToPaidClientPct: 18 },
        lifetimeRevenueUsd: 1400,
      });

    expect(res.status).toBe(200);
    const funnel = res.body.funnel;
    expect(funnel.funnelKey).toBe('sales_from_conversation');
    expect(funnel.active).toBe(true);
    expect(funnel.steps).toEqual(['Positive reply', 'Paid client']);
    expect(funnel.rates).toEqual({ replyToPaidClientPct: 18 });
    expect(funnel.lifetimeRevenueUsd).toBe(1400);
    // No meeting is ever booked and nothing lands on the brand's site.
    expect(funnel.bookingUrl).toBeNull();
    expect(funnel.destinationUrl).toBeNull();
  });

  it('declares and prices the form the advertising platform hosts', async () => {
    const res = await request(app)
      .put(one(brandId, 'lead_forms_from_ads'))
      .set(getAuthHeaders(orgId))
      .send({
        rates: { leadFormToPaidClientPct: 6 },
        lifetimeRevenueUsd: 2600,
      });

    expect(res.status).toBe(200);
    // The channel DELIVERS the filled form, so that is the first step: no click
    // rung before it, because a click is not a step anybody buys.
    expect(res.body.funnel.steps).toEqual(['Lead form submitted', 'Paid client']);
    expect(res.body.funnel.rates).toEqual({ leadFormToPaidClientPct: 6 });
  });

  it('declares the meeting booked straight from an ad, booking link and all', async () => {
    const res = await request(app)
      .put(one(brandId, 'sales_meetings_from_ads'))
      .set(getAuthHeaders(orgId))
      .send({
        rates: { meetingBookedToAttendedPct: 70, meetingToClosePct: 25 },
        bookingUrl: 'https://cal.com/beyond/30min',
      });

    expect(res.status).toBe(200);
    expect(res.body.funnel.steps).toEqual(['Meeting booked', 'Meeting attended', 'Paid client']);
    expect(res.body.funnel.bookingUrl).toBe('https://cal.com/beyond/30min');
    expect(res.body.funnel.rates.meetingBookedToAttendedPct).toBe(70);
  });

  it('rejects a rate from another funnel rather than storing it where nothing reads it', async () => {
    const res = await request(app)
      .put(one(brandId, 'lead_forms_from_ads'))
      .set(getAuthHeaders(orgId))
      .send({ rates: { visitToSignupPct: 30 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not price/);
  });

  it('lets a brand with NO website declare all three — none of them touches its site', async () => {
    for (const key of ['sales_from_conversation', 'sales_meetings_from_ads', 'lead_forms_from_ads']) {
      const res = await request(app)
        .put(one(noWebsiteBrandId, key))
        .set(getAuthHeaders(orgId))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.funnel.funnelKey).toBe(key);
    }
  });

  it('tells a consumer, per funnel, what starts it and which step is its milestone', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(orgId));

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.funnels.map((f: any) => [f.funnelKey, f]));

    expect(byKey.sales_from_conversation.startEvent).toBe('conversation_reply');
    expect(byKey.sales_from_conversation.milestoneStep).toBe('Paid client');

    expect(byKey.lead_forms_from_ads.startEvent).toBe('lead_form_submitted');
    expect(byKey.lead_forms_from_ads.milestoneStep).toBe('Lead form submitted');

    expect(byKey.sales_meetings_from_ads.startEvent).toBe('meeting_booked');
    expect(byKey.sales_meetings_from_ads.milestoneStep).toBe('Meeting booked');

    // The milestone is always a step of the funnel's OWN funnel, so a consumer
    // reads it rather than carrying a funnel-to-step mapping of its own.
    for (const funnel of res.body.funnels) {
      expect(funnel.steps[funnel.milestoneStepIndex]).toBe(funnel.milestoneStep);
    }
  });

  it('answers the internal read with the same two fields', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}/sales-funnels`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', orgId);

    expect(res.status).toBe(200);
    expect(res.body.funnels.length).toBeGreaterThan(0);
    for (const funnel of res.body.funnels) {
      expect([
        'conversation_reply',
        'website_visit',
        'ad_click',
        'meeting_booked',
        'lead_form_submitted',
      ]).toContain(funnel.startEvent);
      expect(funnel.steps).toContain(funnel.milestoneStep);
    }
  });

  it('leaves the funnels a brand already declared exactly as they were', async () => {
    // The original four are untouched by this ship: same keys, same funnels, same
    // milestones, and a brand that declared one before it keeps reading it back.
    const put = await request(app)
      .put(one(brandId, 'website_purchases'))
      .set(getAuthHeaders(orgId))
      .send({ rates: { visitToSignupPct: 30, signupToPaidClientPct: 12 } });

    expect(put.status).toBe(200);
    expect(put.body.funnel.steps).toEqual(['Website visit', 'Signup', 'Paid client']);
    expect(put.body.funnel.startEvent).toBe('website_visit');
    expect(put.body.funnel.milestoneStep).toBe('Signup');
    expect(put.body.funnel.rates).toEqual({ visitToSignupPct: 30, signupToPaidClientPct: 12 });
  });

  it('declares the brand whose buyer lands and BUYS, with the PURCHASE as its own rung', async () => {
    const res = await request(app)
      .put(one(brandId, 'sales_from_website'))
      .set(getAuthHeaders(orgId))
      .send({
        rates: { visitToPurchasePct: 2.5, purchaseToPaidClientPct: 96 },
        lifetimeRevenueUsd: 180,
        destinationUrl: `https://${domain}/shop`,
      });

    expect(res.status).toBe(200);
    const funnel = res.body.funnel;
    expect(funnel.funnelKey).toBe('sales_from_website');
    expect(funnel.name).toBe('Website Purchase');
    expect(funnel.steps).toEqual(['Website visit', 'Purchase', 'Paid client']);
    expect(funnel.startEvent).toBe('website_visit');
    // The purchase is what tells the brand the funnel is working, exactly as a
    // signup does on the signup funnel — the sale is what they keep afterwards.
    expect(funnel.milestoneStep).toBe('Purchase');
    expect(funnel.milestoneStepIndex).toBe(1);
    expect(funnel.rates).toEqual({ visitToPurchasePct: 2.5, purchaseToPaidClientPct: 96 });
    expect(funnel.destinationUrl).toBe(`https://${domain}/shop`);
    expect(funnel.bookingUrl).toBeNull();
  });

  it('draws the purchase funnel as two arrows a consumer can render', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    const funnel = res.body.funnels.find((f: any) => f.funnelKey === 'sales_from_website');
    expect(funnel.arrows.map((a: any) => [a.fromStep, a.toStep, a.ratePct])).toEqual([
      ['Website visit', 'Purchase', 2.5],
      ['Purchase', 'Paid client', 96],
    ]);
  });

  it('still takes the pre-reshape rate word, onto the arrow it was always about', async () => {
    // This funnel shipped one release earlier priced by a single
    // `visitToClosePct`. A caller still sending it must not be told the funnel
    // does not price the arrow they are looking at.
    const res = await request(app)
      .put(one(brandId, 'sales_from_website'))
      .set(getAuthHeaders(orgId))
      .send({ rates: { visitToClosePct: 3.25 } });

    expect(res.status).toBe(200);
    // Resolved, stored and read back under the key that prices the arrow — the
    // retired word is accepted on write and never emitted again.
    expect(res.body.funnel.rates.visitToPurchasePct).toBe(3.25);
    expect(res.body.funnel.rates.visitToClosePct).toBeUndefined();
    // The second arrow is untouched: a caller sending the old word stated one
    // number, and nothing invents the other.
    expect(res.body.funnel.rates.purchaseToPaidClientPct).toBe(96);
  });

  it('refuses the land-and-pay funnel to a brand with no website', async () => {
    const res = await request(app)
      .put(one(noWebsiteBrandId, 'sales_from_website'))
      .set(getAuthHeaders(orgId))
      .send({});

    expect(res.status).toBe(400);
  });

  it('reads the two renamed funnels the way the owner wrote them', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(orgId));
    const byKey = Object.fromEntries(res.body.funnels.map((f: any) => [f.funnelKey, f]));

    // The key stays a wire token nobody renders; the NAME is what moved.
    expect(byKey.website_purchases.name).toBe('Signups');
    expect(byKey.sales_from_conversation.name).toBe('Sale from Positive Reply');
    for (const funnel of res.body.funnels) {
      expect(String(funnel.name).toLowerCase()).not.toContain('conversation');
    }
  });

  it('still accepts a pre-retirement spelling and answers with the canonical key', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_form'))
      .set(getAuthHeaders(orgId))
      .send({ rates: { visitToFormSubmissionPct: 8 } });

    expect(res.status).toBe(200);
    expect(res.body.funnel.funnelKey).toBe('form_magnet');
    expect(res.body.funnel.milestoneStep).toBe('Form filled');
  });
});
