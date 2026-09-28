import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

vi.mock('../../src/lib/campaign-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/campaign-client')>(
    '../../src/lib/campaign-client'
  );
  return { ...actual, listOngoingCampaignIdsForOffer: vi.fn() };
});

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';
import {
  CampaignServiceUnavailableError,
  listOngoingCampaignIdsForOffer,
} from '../../src/lib/campaign-client';

/**
 * ARCHIVING an offer: hidden from the default org listing, nothing deleted,
 * reversible, and refused while a campaign on it is ongoing.
 */
describe('Offer archive', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  const dom = `archive-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let keptId = '';
  let retiredId = '';
  const ongoing = vi.mocked(listOngoingCampaignIdsForOffer);

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Archive Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const a = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Psyllium B2B' });
    const b = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Living Vital' });
    keptId = a.body.offer.offerId;
    retiredId = b.body.offer.offerId;
  });

  beforeEach(() => {
    ongoing.mockReset();
    ongoing.mockResolvedValue([]);
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  });

  it('a new offer reads active', async () => {
    const res = await request(app).get(`${offersPath}/${retiredId}`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.offer).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('refuses to archive an offer with an ongoing campaign, with a named reason, and changes nothing', async () => {
    const campaignId = randomUUID();
    ongoing.mockResolvedValue([campaignId]);
    const res = await request(app).post(`${offersPath}/${retiredId}/archive`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('offer_has_ongoing_campaign');
    expect(res.body.campaignIds).toEqual([campaignId]);
    expect(ongoing).toHaveBeenCalledWith(retiredId, expect.objectContaining({ orgId }));

    const list = await request(app).get(offersPath).set(getAuthHeaders(orgId));
    expect(list.body.offers.map((o: any) => o.offerId)).toContain(retiredId);
  });

  it('answers 502 and changes nothing when campaign-service cannot be asked', async () => {
    ongoing.mockRejectedValue(new CampaignServiceUnavailableError('boom'));
    const res = await request(app).post(`${offersPath}/${retiredId}/archive`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(502);
    const one = await request(app).get(`${offersPath}/${retiredId}`).set(getAuthHeaders(orgId));
    expect(one.body.offer.status).toBe('active');
  });

  it('archives, and the default listing then shows only the other offer', async () => {
    const res = await request(app).post(`${offersPath}/${retiredId}/archive`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('archived');
    expect(typeof res.body.offer.archivedAt).toBe('string');

    const list = await request(app).get(offersPath).set(getAuthHeaders(orgId));
    expect(list.body.offers.map((o: any) => o.offerId)).toEqual([keptId]);

    const all = await request(app).get(`${offersPath}?includeArchived=true`).set(getAuthHeaders(orgId));
    expect(all.body.offers.map((o: any) => [o.offerId, o.status])).toEqual([
      [keptId, 'active'],
      [retiredId, 'archived'],
    ]);
  });

  it('archiving again is idempotent and keeps the original timestamp', async () => {
    const before = await request(app).get(`${offersPath}/${retiredId}`).set(getAuthHeaders(orgId));
    const res = await request(app).post(`${offersPath}/${retiredId}/archive`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.offer.archivedAt).toBe(before.body.offer.archivedAt);
  });

  it('keeps the archived offer readable by id and on the internal listing (history is kept)', async () => {
    const one = await request(app).get(`${offersPath}/${retiredId}`).set(getAuthHeaders(orgId));
    expect(one.status).toBe(200);
    const internal = await request(app)
      .get(`/internal/brands/${brandId}/offers`)
      .set({ ...getInternalAuthHeaders(), 'x-org-id': orgId });
    expect(internal.status).toBe(200);
    expect(internal.body.offers.map((o: any) => o.offerId)).toEqual([keptId, retiredId]);
  });

  it('a brand-scoped call still sees both offers (archiving changes no existing resolution)', async () => {
    const res = await request(app).get(`/orgs/brands/${brandId}/user-fields`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(409);
  });

  it('unarchive restores it to the default listing', async () => {
    const res = await request(app).post(`${offersPath}/${retiredId}/unarchive`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.offer).toMatchObject({ status: 'active', archivedAt: null });
    const list = await request(app).get(offersPath).set(getAuthHeaders(orgId));
    expect(list.body.offers.map((o: any) => o.offerId)).toEqual([keptId, retiredId]);
  });

  it('404s an offer of another brand and 400s a bad query value', async () => {
    const miss = await request(app).post(`${offersPath}/${randomUUID()}/archive`).set(getAuthHeaders(orgId));
    expect(miss.status).toBe(404);
    const bad = await request(app).get(`${offersPath}?includeArchived=yes`).set(getAuthHeaders(orgId));
    expect(bad.status).toBe(400);
  });
});
