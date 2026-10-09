import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

/** WHICH SALES PATHS THE CUSTOMER SELECTED: never stated distinct from stated empty. */
describe('Offer selected sales paths', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const brandId = randomUUID();
  const dom = `selpaths-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const headers = () => ({ ...getAuthHeaders(orgId), 'x-user-id': userId });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Selected Paths Brand' });
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

  describe('selected sales paths', () => {
    const pathOf = (offerId: string) => `${offersPath}/${offerId}/selected-sales-paths`;
    const long =
      'start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@ai-meeting-booking+' +
      'meeting_booked_to_meeting_attended+meeting_attended_to_paid_client';
    const longNew = long.replace('start_to_conversation@', 'lead_found_to_conversation@');

    it('an offer that never stated paths reads as not stated', async () => {
      const res = await request(app).get(pathOf(offerA)).set(headers());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ offerId: offerA, stated: false, combinationKeys: null, statedAt: null, statedByUserId: null });
    });

    it('saves paths (outbound legs in the new spelling), records who, and reads them back exactly', async () => {
      const combinationKeys = [long, 'start_to_website_visit@cold-linkedin-outreach', 'not-in-any-catalogue'];
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({
        offerId: offerA,
        stated: true,
        combinationKeys: [longNew, 'lead_found_to_website_visit@cold-linkedin-outreach', 'not-in-any-catalogue'],
        statedByUserId: userId,
      });
      expect(typeof put.body.statedAt).toBe('string');
      const get = await request(app).get(pathOf(offerA)).set(headers());
      expect(get.body).toEqual(put.body);
    });

    it('a write replaces the whole list', async () => {
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [long] });
      expect(put.body.combinationKeys).toEqual([longNew]);
    });

    it('an empty list is stated, not absent; the other offer is untouched', async () => {
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [] });
      expect(put.body).toMatchObject({ stated: true, combinationKeys: [] });
      const other = await request(app).get(pathOf(offerB)).set(headers());
      expect(other.body.stated).toBe(false);
    });

    it('refuses a malformed body or a key twice', async () => {
      expect((await request(app).put(pathOf(offerA)).set(headers()).send({})).status).toBe(400);
      expect((await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [''] })).status).toBe(400);
      const dup = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [long, long] });
      expect(dup.status).toBe(400);
    });

    it('the legacy and new outbound spelling are one key: twice = 400, the new one stored', async () => {
      const renamed = longNew;
      const both = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [long, renamed] });
      expect(both.status).toBe(400);
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: [renamed] });
      expect(put.status).toBe(200);
      expect(put.body.combinationKeys).toEqual([renamed]);
      // A non-outbound feature keeps start_to_website_visit as its own key.
      const ads = ['start_to_website_visit@google-ads+website_visit_to_signup', 'lead_found_to_website_visit@google-ads+website_visit_to_signup'];
      const adsPut = await request(app).put(pathOf(offerA)).set(headers()).send({ combinationKeys: ads });
      expect(adsPut.status).toBe(200);
      expect(adsPut.body.combinationKeys).toEqual(ads);
    });

    it("404s an unknown offer and refuses another org's brand", async () => {
      expect((await request(app).get(pathOf(randomUUID())).set(headers())).status).toBe(404);
      expect([403, 404]).toContain((await request(app).get(pathOf(offerA)).set(getAuthHeaders(otherOrgId))).status);
      const put = await request(app).put(pathOf(offerA)).set(getAuthHeaders(otherOrgId)).send({ combinationKeys: [long] });
      expect([403, 404]).toContain(put.status);
    });

    it('the internal read, keyed on the offer alone, answers the same', async () => {
      await request(app).put(pathOf(offerB)).set(headers()).send({ combinationKeys: [long] });
      const res = await request(app).get(`/internal/offers/${offerB}/selected-sales-paths`).set(getInternalAuthHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ offerId: offerB, stated: true, combinationKeys: [longNew] });
      const missing = await request(app).get(`/internal/offers/${randomUUID()}/selected-sales-paths`).set(getInternalAuthHeaders());
      expect(missing.status).toBe(404);
    });
  });
});
