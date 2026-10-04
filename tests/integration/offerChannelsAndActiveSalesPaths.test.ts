import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

/**
 * WHICH CHANNELS AN OFFER ACCEPTS (never stated distinct from stated empty) and
 * WHICH SALES PATHS the customer activated (one per entry, atomic replace,
 * append-only history).
 */
describe('Offer channels and active sales paths', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const brandId = randomUUID();
  const dom = `paths-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const headers = () => ({ ...getAuthHeaders(orgId), 'x-user-id': userId });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Paths Brand' });
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

  describe('active sales paths', () => {
    const base = (offerId: string) => `${offersPath}/${offerId}/active-sales-paths`;
    const email = {
      combinationKey: 'start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@ai-meeting-booking',
      entryChannelSlug: 'sales-cold-email-outreach',
      entryLegKey: 'start_to_conversation',
    };
    const emailAlt = {
      combinationKey: 'start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@your-team-meeting',
      entryChannelSlug: 'sales-cold-email-outreach',
      entryLegKey: 'start_to_conversation',
    };
    const visits = {
      combinationKey: 'start_to_website_visit@sales-cold-email-outreach+website_visit_to_purchase',
      entryChannelSlug: 'sales-cold-email-outreach',
      entryLegKey: 'start_to_website_visit',
    };

    it('nothing activated reads as an empty list', async () => {
      const res = await request(app).get(base(offerA)).set(headers());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ offerId: offerA, activeSalesPaths: [] });
    });

    it('activates a path (201) and a retry is a no-op (200)', async () => {
      const first = await request(app).post(base(offerA)).set(headers()).send(email);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        activated: true,
        replaced: null,
        activeSalesPath: { ...email, status: 'active', activatedByUserId: userId, endedAt: null },
      });
      const again = await request(app).post(base(offerA)).set(headers()).send(email);
      expect(again.status).toBe(200);
      expect(again.body.activated).toBe(false);
      expect(again.body.activeSalesPath.id).toBe(first.body.activeSalesPath.id);
    });

    it('a second path on ANOTHER entry activates beside it', async () => {
      const res = await request(app).post(base(offerA)).set(headers()).send(visits);
      expect(res.status).toBe(201);
      const list = await request(app).get(base(offerA)).set(headers());
      expect(list.body.activeSalesPaths.map((p: any) => p.combinationKey).sort()).toEqual(
        [email.combinationKey, visits.combinationKey].sort()
      );
    });

    it('a second path on the SAME entry is refused 409 and names the holder', async () => {
      const res = await request(app).post(base(offerA)).set(headers()).send(emailAlt);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SALES_PATH_ENTRY_TAKEN');
      expect(res.body.activeSalesPath.combinationKey).toBe(email.combinationKey);
      const list = await request(app).get(base(offerA)).set(headers());
      expect(list.body.activeSalesPaths).toHaveLength(2);
    });

    it('the same combination sent with another entry is a 409 mismatch', async () => {
      const res = await request(app).post(base(offerA)).set(headers()).send({ ...email, entryLegKey: 'start_to_website_visit' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SALES_PATH_ENTRY_MISMATCH');
    });

    it('replace: true ends the holder and activates the new path atomically', async () => {
      const before = await request(app).get(base(offerA)).set(headers());
      const holderId = before.body.activeSalesPaths.find((p: any) => p.combinationKey === email.combinationKey).id;

      const res = await request(app).post(base(offerA)).set(headers()).send({ ...emailAlt, replace: true });
      expect(res.status).toBe(201);
      expect(res.body.activeSalesPath).toMatchObject({ ...emailAlt, status: 'active' });
      expect(res.body.replaced).toMatchObject({
        id: holderId,
        status: 'replaced',
        replacedById: res.body.activeSalesPath.id,
        endedByUserId: userId,
      });

      const list = await request(app).get(base(offerA)).set(headers());
      expect(list.body.activeSalesPaths.map((p: any) => p.combinationKey).sort()).toEqual(
        [emailAlt.combinationKey, visits.combinationKey].sort()
      );
    });

    it('concurrent replaces on one entry leave exactly one active path there', async () => {
      const a = { ...email, replace: true };
      const results = await Promise.all([
        request(app).post(base(offerA)).set(headers()).send(a),
        request(app).post(base(offerA)).set(headers()).send(a),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      const list = await request(app).get(base(offerA)).set(headers());
      const onEntry = list.body.activeSalesPaths.filter(
        (p: any) => p.entryChannelSlug === email.entryChannelSlug && p.entryLegKey === email.entryLegKey
      );
      expect(onEntry).toHaveLength(1);
      expect(onEntry[0].combinationKey).toBe(email.combinationKey);
    });

    it('deactivates a path; deactivating it again is a 404', async () => {
      const res = await request(app).post(`${base(offerA)}/deactivate`).set(headers()).send({ combinationKey: visits.combinationKey });
      expect(res.status).toBe(200);
      expect(res.body.deactivated).toMatchObject({ ...visits, status: 'deactivated', endedByUserId: userId, replacedById: null });
      const again = await request(app).post(`${base(offerA)}/deactivate`).set(headers()).send({ combinationKey: visits.combinationKey });
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('SALES_PATH_NOT_ACTIVE');
    });

    it('history keeps every activation, newest first, nothing deleted', async () => {
      const res = await request(app).get(`${base(offerA)}/history`).set(headers());
      expect(res.status).toBe(200);
      const statuses = res.body.history.map((p: any) => `${p.combinationKey}:${p.status}`);
      expect(statuses).toEqual(
        expect.arrayContaining([
          `${email.combinationKey}:replaced`,
          `${emailAlt.combinationKey}:replaced`,
          `${email.combinationKey}:active`,
          `${visits.combinationKey}:deactivated`,
        ])
      );
      expect(res.body.history).toHaveLength(4);
    });

    it('refuses a malformed body, an unknown offer, another org', async () => {
      expect((await request(app).post(base(offerA)).set(headers()).send({ combinationKey: 'x' })).status).toBe(400);
      expect((await request(app).get(base(randomUUID())).set(headers())).status).toBe(404);
      expect([403, 404]).toContain((await request(app).get(base(offerA)).set(getAuthHeaders(otherOrgId))).status);
    });

    it('internal reads by offer and by brand answer the same active set', async () => {
      await request(app).post(base(offerB)).set(headers()).send(visits);
      const byOffer = await request(app).get(`/internal/offers/${offerA}/active-sales-paths`).set(getInternalAuthHeaders());
      expect(byOffer.status).toBe(200);
      expect(byOffer.body.activeSalesPaths.map((p: any) => p.combinationKey)).toEqual([email.combinationKey]);

      const history = await request(app).get(`/internal/offers/${offerA}/active-sales-paths/history`).set(getInternalAuthHeaders());
      expect(history.body.history).toHaveLength(4);

      const byBrand = await request(app).get(`/internal/brands/${brandId}/active-sales-paths`).set(getInternalAuthHeaders());
      expect(byBrand.status).toBe(200);
      expect(byBrand.body.activeSalesPaths.map((p: any) => `${p.offerId}:${p.combinationKey}:${p.orgId}`).sort()).toEqual(
        [`${offerA}:${email.combinationKey}:${orgId}`, `${offerB}:${visits.combinationKey}:${orgId}`].sort()
      );
      const otherOrg = await request(app)
        .get(`/internal/brands/${brandId}/active-sales-paths`)
        .set({ ...getInternalAuthHeaders(), 'x-org-id': otherOrgId });
      expect(otherOrg.body.activeSalesPaths).toEqual([]);

      expect((await request(app).get(`/internal/offers/${randomUUID()}/active-sales-paths`).set(getInternalAuthHeaders())).status).toBe(404);
    });
  });
});
