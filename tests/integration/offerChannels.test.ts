import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

/** WHICH CHANNELS AN OFFER ACCEPTS: never stated distinct from stated empty. */
describe('Offer channels', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const brandId = randomUUID();
  const dom = `channels-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const headers = () => ({ ...getAuthHeaders(orgId), 'x-user-id': userId });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Channels Brand' });
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

  describe('channels', () => {
    const pathOf = (offerId: string) => `${offersPath}/${offerId}/channels`;

    it('an offer that never stated channels reads as not stated', async () => {
      const res = await request(app).get(pathOf(offerA)).set(headers());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ offerId: offerA, stated: false, channelSlugs: null, statedAt: null, statedByUserId: null });
    });

    it('saves channels, records who, and reads them back exactly', async () => {
      const channelSlugs = ['sales-cold-email-outreach', 'ai-meeting-booking', 'meta-ads'];
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ channelSlugs });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ offerId: offerA, stated: true, channelSlugs, statedByUserId: userId });
      const get = await request(app).get(pathOf(offerA)).set(headers());
      expect(get.body).toEqual(put.body);
    });

    it('an empty list is stated, not absent; the other offer is untouched', async () => {
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ channelSlugs: [] });
      expect(put.body).toMatchObject({ stated: true, channelSlugs: [] });
      const other = await request(app).get(pathOf(offerB)).set(headers());
      expect(other.body.stated).toBe(false);
    });

    it('refuses a malformed body or a slug twice', async () => {
      expect((await request(app).put(pathOf(offerA)).set(headers()).send({})).status).toBe(400);
      const dup = await request(app).put(pathOf(offerA)).set(headers()).send({ channelSlugs: ['a', 'a'] });
      expect(dup.status).toBe(400);
    });

    it("404s an unknown offer and refuses another org's brand", async () => {
      expect((await request(app).get(pathOf(randomUUID())).set(headers())).status).toBe(404);
      expect([403, 404]).toContain((await request(app).get(pathOf(offerA)).set(getAuthHeaders(otherOrgId))).status);
    });

    it('the internal read, keyed on the offer alone, answers the same', async () => {
      await request(app).put(pathOf(offerB)).set(headers()).send({ channelSlugs: ['ai-instant-call'] });
      const res = await request(app).get(`/internal/offers/${offerB}/channels`).set(getInternalAuthHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ offerId: offerB, stated: true, channelSlugs: ['ai-instant-call'] });
      expect((await request(app).get(`/internal/offers/${randomUUID()}/channels`).set(getInternalAuthHeaders())).status).toBe(404);
    });
  });
});
