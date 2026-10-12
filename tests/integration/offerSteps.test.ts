import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

vi.mock('../../src/lib/features-step-catalogue', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/features-step-catalogue')>(
    '../../src/lib/features-step-catalogue'
  );
  return { ...actual, fetchStepCatalogue: vi.fn() };
});

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferSalesPaths } from '../../src/db';
import { fetchStepCatalogue, StepCatalogueUnavailableError } from '../../src/lib/features-step-catalogue';

/**
 * THE STEPS AN OFFER'S BUSINESS HAS (owner 2026-10-12): read, add one, remove one,
 * stored in the `steps` column of `brand_offer_sales_paths`. Never a leg or a channel.
 */
const CATALOGUE = [
  'booking_call',
  'conversation',
  'form_submitted',
  'lead_found',
  'meeting_attended',
  'meeting_booked',
  'paid_client',
  'purchase',
  'signup',
  'website_visit',
].map((key) => ({ key, name: key }));

describe('Offer steps', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const otherBrandId = randomUUID();
  let statedOfferId = '';
  let blankOfferId = '';
  let legacyOfferId = '';
  let foreignOfferId = '';
  const catalogue = vi.mocked(fetchStepCatalogue);
  const stepsPath = (offerId: string, b = brandId) => `/orgs/brands/${b}/offers/${offerId}/steps`;

  async function makeOffer(org: string, brand: string, name: string): Promise<string> {
    const res = await request(app).post(`/orgs/brands/${brand}/offers`).set(getAuthHeaders(org)).send({ name });
    expect(res.status).toBe(201);
    return res.body.offer.offerId;
  }

  beforeAll(async () => {
    for (const [id, org] of [
      [brandId, orgId],
      [otherBrandId, otherOrgId],
    ]) {
      const dom = `steps-${id.slice(0, 8)}.com`;
      await db.insert(brands).values({ id, url: `https://${dom}`, domain: dom, name: `Steps ${id.slice(0, 4)}` });
      await db.insert(orgBrands).values({ orgId: org, brandId: id });
    }
    statedOfferId = await makeOffer(orgId, brandId, 'Doc Dinners Like');
    blankOfferId = await makeOffer(orgId, brandId, 'Never Stated');
    legacyOfferId = await makeOffer(orgId, brandId, 'Legacy Row');
    foreignOfferId = await makeOffer(otherOrgId, otherBrandId, 'Someone Else');

    // The shape the retired sales path wrote (2026-10-08, Doc Dinners).
    await db.insert(brandOfferSalesPaths).values({
      offerId: statedOfferId,
      steps: ['conversation', 'booking_call', 'meeting_booked', 'meeting_attended', 'website_visit'],
      legKeys: ['lead_found_to_conversation', 'conversation_to_booking_call'],
      legs: ['lead_found_to_conversation@sales-cold-email-outreach', 'conversation_to_booking_call'],
      statedAt: '2026-10-08T17:18:58.221Z',
    });
    // A pre-0092 row: `legs` NULL.
    await db.insert(brandOfferSalesPaths).values({
      offerId: legacyOfferId,
      steps: ['website_visit', 'signup'],
      legKeys: ['start_to_website_visit', 'website_visit_to_signup'],
      legs: null,
      statedAt: '2026-09-20T10:00:00.000Z',
    });
    await db.insert(brandOfferSalesPaths).values({
      offerId: foreignOfferId,
      steps: ['conversation'],
      legKeys: [],
      legs: [],
      statedAt: '2026-10-01T10:00:00.000Z',
    });
  });

  beforeEach(() => {
    catalogue.mockReset();
    catalogue.mockResolvedValue(CATALOGUE);
  });

  afterAll(async () => {
    await db
      .delete(brandOfferSalesPaths)
      .where(inArray(brandOfferSalesPaths.offerId, [statedOfferId, blankOfferId, legacyOfferId, foreignOfferId]));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId, otherBrandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId, otherBrandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId, otherBrandId]));
  });

  it('reads a stated offer: its steps, no purchase, and no leg or channel', async () => {
    const res = await request(app).get(stepsPath(statedOfferId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      offerId: statedOfferId,
      stated: true,
      steps: ['conversation', 'booking_call', 'meeting_booked', 'meeting_attended', 'website_visit'],
      statedAt: expect.any(String),
    });
    expect(res.body.steps).not.toContain('purchase');
    expect(catalogue).not.toHaveBeenCalled();
  });

  it('reads an offer that never stated its steps as not stated, distinct from an empty list', async () => {
    const res = await request(app).get(stepsPath(blankOfferId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ offerId: blankOfferId, stated: false, steps: null, statedAt: null });
  });

  it('reads a legacy row (legs NULL) by its steps', async () => {
    const res = await request(app).get(stepsPath(legacyOfferId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stated: true, steps: ['website_visit', 'signup'] });
    expect(Object.keys(res.body).sort()).toEqual(['offerId', 'stated', 'statedAt', 'steps']);
  });

  it('adds one step at the end, then a second add is a no-op', async () => {
    const add = await request(app).put(`${stepsPath(legacyOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ stated: true, changed: true, steps: ['website_visit', 'signup', 'purchase'] });

    const again = await request(app).put(`${stepsPath(legacyOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ changed: false, steps: ['website_visit', 'signup', 'purchase'] });

    // The retired legs are left exactly as they were.
    const [row] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, legacyOfferId));
    expect(row.legKeys).toEqual(['start_to_website_visit', 'website_visit_to_signup']);
    expect(row.legs).toBeNull();
  });

  it('removes one step, then a second remove is a no-op', async () => {
    const del = await request(app).delete(`${stepsPath(legacyOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ stated: true, changed: true, steps: ['website_visit', 'signup'] });

    const again = await request(app).delete(`${stepsPath(legacyOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ changed: false, steps: ['website_visit', 'signup'] });
  });

  it('a first add on a never-stated offer states it; removing its only step leaves an empty STATED list', async () => {
    const noop = await request(app).delete(`${stepsPath(blankOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(noop.body).toMatchObject({ stated: false, steps: null, changed: false });

    const add = await request(app).put(`${stepsPath(blankOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(add.body).toMatchObject({ stated: true, steps: ['purchase'], changed: true });
    const [row] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, blankOfferId));
    expect(row.legKeys).toEqual([]);

    const del = await request(app).delete(`${stepsPath(blankOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(del.body).toMatchObject({ stated: true, steps: [], changed: true });
  });

  it('refuses a step outside the catalogue with a named 400, writing nothing', async () => {
    const res = await request(app).put(`${stepsPath(statedOfferId)}/teleport`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ reason: 'unknown_step', stepKey: 'teleport' });
    expect(res.body.knownSteps).toContain('purchase');

    const del = await request(app).delete(`${stepsPath(statedOfferId)}/teleport`).set(getAuthHeaders(orgId));
    expect(del.status).toBe(400);
    expect(del.body.reason).toBe('unknown_step');

    const bad = await request(app).put(`${stepsPath(statedOfferId)}/Not%20A%20Key`).set(getAuthHeaders(orgId));
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('unknown_step');

    const read = await request(app).get(stepsPath(statedOfferId)).set(getAuthHeaders(orgId));
    expect(read.body.steps).toHaveLength(5);
  });

  it('answers 502 and writes nothing when the catalogue cannot be read', async () => {
    catalogue.mockRejectedValue(new StepCatalogueUnavailableError('HTTP 503'));
    const res = await request(app).put(`${stepsPath(statedOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('step_catalogue_unavailable');
    const read = await request(app).get(stepsPath(statedOfferId)).set(getAuthHeaders(orgId));
    expect(read.body.steps).not.toContain('purchase');
  });

  it("refuses another org's offer, read and write, and changes nothing", async () => {
    // Their brand: 403.
    const read = await request(app).get(stepsPath(foreignOfferId, otherBrandId)).set(getAuthHeaders(orgId));
    expect(read.status).toBe(403);
    const add = await request(app).put(`${stepsPath(foreignOfferId, otherBrandId)}/purchase`).set(getAuthHeaders(orgId));
    expect(add.status).toBe(403);
    // Their offer under our brand: 404.
    const viaOurs = await request(app).put(`${stepsPath(foreignOfferId)}/purchase`).set(getAuthHeaders(orgId));
    expect(viaOurs.status).toBe(404);
    expect(viaOurs.body.code).toBe('OFFER_NOT_FOUND');
    const del = await request(app).delete(`${stepsPath(foreignOfferId)}/conversation`).set(getAuthHeaders(orgId));
    expect(del.status).toBe(404);

    const [row] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, foreignOfferId));
    expect(row.steps).toEqual(['conversation']);
  });

  it('rejects a malformed offer id', async () => {
    const res = await request(app).get(`/orgs/brands/${brandId}/offers/not-a-uuid/steps`).set(getAuthHeaders(orgId));
    expect(res.status).toBe(400);
  });
});
