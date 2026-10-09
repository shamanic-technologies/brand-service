import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

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
    expect(res.body).toEqual({ offerId: offerA, stated: false, steps: null, legKeys: null, statedAt: null });
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
});
