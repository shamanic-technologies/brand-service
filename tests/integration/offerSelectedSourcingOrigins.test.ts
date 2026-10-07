import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

/** WHICH SOURCING ORIGINS THE CUSTOMER SELECTED: never stated distinct from stated empty. */
describe('Offer selected sourcing origins', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const brandId = randomUUID();
  const dom = `selsrc-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const headers = () => ({ ...getAuthHeaders(orgId), 'x-user-id': userId });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Selected Sourcing Brand' });
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

  describe('selected sourcing origins', () => {
    const pathOf = (offerId: string) => `${offersPath}/${offerId}/selected-sourcing-origins`;
    const long = 'sourcing-apollo-cold-filters';

    it('an offer that never stated origins reads as not stated', async () => {
      const res = await request(app).get(pathOf(offerA)).set(headers());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ offerId: offerA, stated: false, originSlugs: null, statedAt: null, statedByUserId: null });
    });

    it('saves origins as given, records who, and reads them back exactly', async () => {
      const originSlugs = [long, 'sourcing-crm-contacts', 'not-in-any-catalogue'];
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ originSlugs });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ offerId: offerA, stated: true, originSlugs, statedByUserId: userId });
      expect(typeof put.body.statedAt).toBe('string');
      const get = await request(app).get(pathOf(offerA)).set(headers());
      expect(get.body).toEqual(put.body);
    });

    it('a write replaces the whole list', async () => {
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ originSlugs: [long] });
      expect(put.body.originSlugs).toEqual([long]);
    });

    it('an empty list is stated, not absent; the other offer is untouched', async () => {
      const put = await request(app).put(pathOf(offerA)).set(headers()).send({ originSlugs: [] });
      expect(put.body).toMatchObject({ stated: true, originSlugs: [] });
      const other = await request(app).get(pathOf(offerB)).set(headers());
      expect(other.body.stated).toBe(false);
    });

    it('refuses a malformed body or a key twice', async () => {
      expect((await request(app).put(pathOf(offerA)).set(headers()).send({})).status).toBe(400);
      expect((await request(app).put(pathOf(offerA)).set(headers()).send({ originSlugs: [''] })).status).toBe(400);
      const dup = await request(app).put(pathOf(offerA)).set(headers()).send({ originSlugs: [long, long] });
      expect(dup.status).toBe(400);
    });

    it("404s an unknown offer and refuses another org's brand", async () => {
      expect((await request(app).get(pathOf(randomUUID())).set(headers())).status).toBe(404);
      expect([403, 404]).toContain((await request(app).get(pathOf(offerA)).set(getAuthHeaders(otherOrgId))).status);
      const put = await request(app).put(pathOf(offerA)).set(getAuthHeaders(otherOrgId)).send({ originSlugs: [long] });
      expect([403, 404]).toContain(put.status);
    });

    it('the internal read, keyed on the offer alone, answers the same', async () => {
      await request(app).put(pathOf(offerB)).set(headers()).send({ originSlugs: [long] });
      const res = await request(app).get(`/internal/offers/${offerB}/selected-sourcing-origins`).set(getInternalAuthHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ offerId: offerB, stated: true, originSlugs: [long] });
      const missing = await request(app).get(`/internal/offers/${randomUUID()}/selected-sourcing-origins`).set(getInternalAuthHeaders());
      expect(missing.status).toBe(404);
    });
  });
});
