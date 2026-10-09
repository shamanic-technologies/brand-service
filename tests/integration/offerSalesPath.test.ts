import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferSalesPaths } from '../../src/db';
import { eq } from 'drizzle-orm';

/**
 * HOW AN OFFER SELLS: the steps and legs a customer selects for ONE offer,
 * saved and read back exactly, never stated distinct from stated-empty, and
 * another offer of the same brand untouched.
 */
describe('Offer sales path', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const dom = `salespath-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Sales Path Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const a = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Self Serve' });
    const b = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Enterprise' });
    offerA = a.body.offer.offerId;
    offerB = b.body.offer.offerId;
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  });

  const pathOf = (offerId: string) => `${offersPath}/${offerId}/sales-path`;

  it('an offer that never saved reads as not stated', async () => {
    const res = await request(app).get(pathOf(offerA)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ offerId: offerA, stated: false, steps: null, legKeys: null, legs: null, statedAt: null });
  });

  it('saves a selection and reads back what it saved, the outbound entry leg in its new spelling', async () => {
    const selection = {
      steps: ['website_visit', 'signup', 'paid_client'],
      legKeys: ['start_to_website_visit', 'website_visit_to_signup', 'signup_to_paid_client'],
    };
    const put = await request(app).put(pathOf(offerA)).set(getAuthHeaders(orgId)).send(selection);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      offerId: offerA,
      stated: true,
      steps: selection.steps,
      legKeys: ['lead_found_to_website_visit', 'website_visit_to_signup', 'signup_to_paid_client'],
    });
    expect(typeof put.body.statedAt).toBe('string');

    const get = await request(app).get(pathOf(offerA)).set(getAuthHeaders(orgId));
    expect(get.body).toEqual(put.body);
  });

  it('another offer of the same brand is unaffected', async () => {
    const res = await request(app).get(pathOf(offerB)).set(getAuthHeaders(orgId));
    expect(res.body.stated).toBe(false);
  });

  it('the legacy and new spelling of one leg collapse onto one entry; the new one is accepted as is', async () => {
    const put = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: ['conversation'], legKeys: ['start_to_conversation', 'conversation_to_paid_client', 'lead_found_to_conversation'] });
    expect(put.status).toBe(200);
    expect(put.body.legKeys).toEqual(['lead_found_to_conversation', 'conversation_to_paid_client']);
    const again = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: ['conversation'], legKeys: ['lead_found_to_conversation', 'conversation_to_paid_client'] });
    expect(again.body.legKeys).toEqual(put.body.legKeys);
  });

  it('a later save replaces the selection; an empty selection is stated, not absent', async () => {
    const put = await request(app).put(pathOf(offerA)).set(getAuthHeaders(orgId)).send({ steps: [], legKeys: [] });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ stated: true, steps: [], legKeys: [] });
  });

  it('refuses a malformed body', async () => {
    const res = await request(app).put(pathOf(offerA)).set(getAuthHeaders(orgId)).send({ steps: ['x'] });
    expect(res.status).toBe(400);
  });

  it('404s an offer that is not on this brand', async () => {
    const res = await request(app).get(pathOf(randomUUID())).set(getAuthHeaders(orgId));
    expect(res.status).toBe(404);
  });

  it("refuses another org's brand", async () => {
    const res = await request(app).get(pathOf(offerA)).set(getAuthHeaders(otherOrgId));
    expect([403, 404]).toContain(res.status);
  });

  it('the internal read, keyed on the offer alone, answers the same', async () => {
    await request(app).put(pathOf(offerB)).set(getAuthHeaders(orgId)).send({ steps: ['conversation'], legKeys: ['start_to_conversation'] });
    const res = await request(app).get(`/internal/offers/${offerB}/sales-path`).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ offerId: offerB, stated: true, steps: ['conversation'], legKeys: ['lead_found_to_conversation'] });
    const missing = await request(app).get(`/internal/offers/${randomUUID()}/sales-path`).set(getInternalAuthHeaders());
    expect(missing.status).toBe(404);
  });

  const legacyLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('legacy-outbound-leg-key'));

  it('Google Ads and cold email each keep their own website visit, read back exactly', async () => {
    const legs = [
      { legKey: 'start_to_website_visit', featureSlug: 'google-ads' },
      { legKey: 'lead_found_to_website_visit', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'website_visit_to_signup', featureSlug: null },
    ];
    const put = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: ['website_visit', 'signup'], legs });
    expect(put.status).toBe(200);
    expect(put.body.legs).toEqual(legs);
    expect(put.body.legKeys).toEqual(['start_to_website_visit', 'lead_found_to_website_visit', 'website_visit_to_signup']);
    const internal = await request(app).get(`/internal/offers/${offerA}/sales-path`).set(getInternalAuthHeaders());
    expect(internal.body.legs).toEqual(legs);
    const [row] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerA));
    expect(row.legs).toEqual([
      'start_to_website_visit@google-ads',
      'lead_found_to_website_visit@sales-cold-email-outreach',
      'website_visit_to_signup',
    ]);
  });

  it('an entry leg naming no channel is refused loudly and nothing is written', async () => {
    const before = await request(app).get(pathOf(offerA)).set(getAuthHeaders(orgId));
    const res = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: ['website_visit'], legs: [{ legKey: 'start_to_website_visit', featureSlug: null }] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ reason: 'entry_leg_without_channel', legKey: 'start_to_website_visit' });
    const after = await request(app).get(pathOf(offerA)).set(getAuthHeaders(orgId));
    expect(after.body).toEqual(before.body);
  });

  it('refuses a body with both shapes, or a leg part carrying "@"', async () => {
    const both = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: [], legs: [], legKeys: [] });
    expect(both.status).toBe(400);
    const at = await request(app)
      .put(pathOf(offerA))
      .set(getAuthHeaders(orgId))
      .send({ steps: [], legKeys: ['start_to_website_visit@google-ads'] });
    expect(at.status).toBe(400);
  });

  it('the legacy bare shape still answers the same: its entry legs are cold email', async () => {
    const put = await request(app)
      .put(pathOf(offerB))
      .set(getAuthHeaders(orgId))
      .send({ steps: ['conversation'], legKeys: ['lead_found_to_conversation', 'conversation_to_paid_client'] });
    expect(put.status).toBe(200);
    expect(put.body.legKeys).toEqual(['lead_found_to_conversation', 'conversation_to_paid_client']);
    expect(put.body.legs).toEqual([
      { legKey: 'lead_found_to_conversation', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'conversation_to_paid_client', featureSlug: null },
    ]);
  });

  it('a legacy outbound spelling logs one legacy-outbound-leg-key line per key; the new spelling logs nothing', async () => {
    const spy = vi.spyOn(console, 'warn');
    try {
      await request(app)
        .put(pathOf(offerB))
        .set(getAuthHeaders(orgId))
        .send({ steps: ['conversation'], legs: [{ legKey: 'lead_found_to_conversation', featureSlug: 'sales-cold-email-outreach' }] });
      expect(legacyLines(spy)).toEqual([]);

      const res = await request(app)
        .put(pathOf(offerB))
        .set(getAuthHeaders(orgId))
        .send({ steps: ['conversation'], legKeys: ['start_to_conversation', 'conversation_to_paid_client'] });
      expect(res.body.legKeys).toEqual(['lead_found_to_conversation', 'conversation_to_paid_client']);
      const lines = legacyLines(spy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('start_to_conversation@sales-cold-email-outreach');
      expect(lines[0]).toContain('/sales-path');
      expect(lines[0]).toContain(orgId);

      spy.mockClear();
      await request(app)
        .put(`${offersPath}/${offerB}/selected-sales-paths`)
        .set(getAuthHeaders(orgId))
        .send({
          combinationKeys: [
            'start_to_conversation@sales-cold-email-outreach+conversation_to_paid_client',
            'start_to_website_visit@google-ads+website_visit_to_signup',
          ],
        });
      const selected = legacyLines(spy);
      expect(selected).toHaveLength(1);
      expect(selected[0]).toContain('start_to_conversation@sales-cold-email-outreach');
      expect(selected[0]).toContain('/selected-sales-paths');
    } finally {
      spy.mockRestore();
    }
  });
});
