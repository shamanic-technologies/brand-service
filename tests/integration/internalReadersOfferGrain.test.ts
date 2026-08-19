import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandUserFields } from '../../src/db';
import { brandProfileService } from '../../src/services/brandProfileService';
import { OfferNotFoundError, SeveralOffersError } from '../../src/services/brandOffersService';

/**
 * THE INTERNAL READERS ASK PER OFFER — and refuse rather than pick one.
 *
 * The confirmed user-fields are one proposition's words. Two readers consume
 * them without ever being asked which proposition: the runtime-context profile
 * read (campaign-service's per-loop snapshot) and the field-extraction prompt,
 * which injects them as authoritative context. Both resolved the brand's SOLE
 * offer, so the day a brand states a second they broke.
 *
 * What closes it is not a default. Each reader's caller can NAME the offer —
 * campaign-service holds a campaign, and a campaign belongs to an offer — and a
 * caller that names none keeps the deliberate 409. Picking one silently would
 * ground a $200 self-serve extraction in a $20k enterprise promise, and the
 * output would read perfectly.
 *
 * These tests pin the three things that must hold together: a brand with ONE
 * offer answers exactly what it answered before (every brand in production),
 * a brand with SEVERAL is answerable the moment the caller names one, and an
 * offer that cannot be resolved fails loudly instead of falling back.
 */
describe('internal readers at the offer grain', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const soleOfferBrandId = randomUUID();
  const twoOfferBrandId = randomUUID();

  const brandIds = [soleOfferBrandId, twoOfferBrandId];

  let soleOfferId = '';
  let starterOfferId = '';
  let enterpriseOfferId = '';

  const runtimePath = (brandId: string) => `/internal/brands/${brandId}/runtime-context`;

  beforeAll(async () => {
    await db.insert(brands).values(
      brandIds.map((id) => ({
        id,
        url: `https://grain-${id.slice(0, 8)}.com`,
        domain: `grain-${id.slice(0, 8)}.com`,
        name: 'Offer Grain Brand',
      })),
    );
    await db.insert(orgBrands).values(brandIds.map((brandId) => ({ orgId, brandId })));

    const sole = await request(app)
      .post(`/orgs/brands/${soleOfferBrandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Only Offer' });
    expect(sole.status).toBe(201);
    soleOfferId = sole.body.offer.offerId;

    const starter = await request(app)
      .post(`/orgs/brands/${twoOfferBrandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Starter Plan' });
    expect(starter.status).toBe(201);
    starterOfferId = starter.body.offer.offerId;

    const enterprise = await request(app)
      .post(`/orgs/brands/${twoOfferBrandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Enterprise' });
    expect(enterprise.status).toBe(201);
    enterpriseOfferId = enterprise.body.offer.offerId;

    // Each proposition states its OWN dream outcome — that difference is what
    // makes a wrong pick observable at all.
    const confirm = async (offerId: string, dreamOutcome: string) => {
      const res = await request(app)
        .put(`/orgs/brands/${offerId === soleOfferId ? soleOfferBrandId : twoOfferBrandId}/offers/${offerId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { dreamOutcome } });
      expect(res.status).toBe(200);
    };

    await confirm(soleOfferId, 'Books qualified meetings');
    await confirm(starterOfferId, 'Ships your first invoice in a day');
    await confirm(enterpriseOfferId, 'Replaces your finance stack');
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, brandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, brandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, brandIds));
    await db.delete(brands).where(inArray(brands.id, brandIds));
  });

  // ── A brand with ONE offer is unchanged ───────────────────────────────────

  it('answers a brand with ONE offer exactly as before, whether or not the offer is named', async () => {
    const unnamed = await brandProfileService.getByBrandId(orgId, soleOfferBrandId);
    const named = await brandProfileService.getByBrandId(orgId, soleOfferBrandId, soleOfferId);

    expect(unnamed.hasConfirmed).toBe(true);
    expect(unnamed.confirmedFields.dreamOutcome).toBe('Books qualified meetings');
    // Byte-for-byte the same answer — naming the sole offer states what
    // resolution already worked out, it does not change the read.
    expect(named).toEqual(unnamed);
  });

  it('serves the sole offer\'s confirmed words on runtime-context with no offerId', async () => {
    const res = await request(app).get(runtimePath(soleOfferBrandId)).set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brandProfile.fields.dreamOutcome).toBe('Books qualified meetings');
  });

  // ── A brand with SEVERAL offers is answerable once one is named ───────────

  it('reads the NAMED offer on a brand selling two things — each proposition its own words', async () => {
    const starter = await brandProfileService.getByBrandId(orgId, twoOfferBrandId, starterOfferId);
    const enterprise = await brandProfileService.getByBrandId(orgId, twoOfferBrandId, enterpriseOfferId);

    expect(starter.confirmedFields.dreamOutcome).toBe('Ships your first invoice in a day');
    expect(enterprise.confirmedFields.dreamOutcome).toBe('Replaces your finance stack');
    // Neither read leaks the other's promise — that leak is the whole failure
    // mode a silent pick would produce, and it would look plausible.
    expect(starter.confirmedFields.dreamOutcome).not.toBe(enterprise.confirmedFields.dreamOutcome);
  });

  it('serves the NAMED offer on runtime-context — the reader that used to throw', async () => {
    const starter = await request(app)
      .get(runtimePath(twoOfferBrandId))
      .query({ offerId: starterOfferId })
      .set(getInternalAuthHeaders());
    const enterprise = await request(app)
      .get(runtimePath(twoOfferBrandId))
      .query({ offerId: enterpriseOfferId })
      .set(getInternalAuthHeaders());

    expect(starter.status).toBe(200);
    expect(enterprise.status).toBe(200);
    expect(starter.body.brandProfile.fields.dreamOutcome).toBe('Ships your first invoice in a day');
    expect(enterprise.body.brandProfile.fields.dreamOutcome).toBe('Replaces your finance stack');
  });

  // ── Unresolvable fails LOUDLY ─────────────────────────────────────────────

  it('refuses a brand-scoped read of a multi-offer brand rather than picking one', async () => {
    await expect(brandProfileService.getByBrandId(orgId, twoOfferBrandId)).rejects.toBeInstanceOf(
      SeveralOffersError,
    );

    const res = await request(app).get(runtimePath(twoOfferBrandId)).set(getInternalAuthHeaders());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEVERAL_OFFERS');
    expect(res.body.offers.map((o: { name: string }) => o.name).sort()).toEqual([
      'Enterprise',
      'Starter Plan',
    ]);
  });

  it('404s an offer id that names nothing on this brand — never a quiet fall back', async () => {
    // Another brand's real offer, and an id that names nothing at all. Both are
    // the caller describing a proposition this brand does not sell.
    await expect(
      brandProfileService.getByBrandId(orgId, twoOfferBrandId, soleOfferId),
    ).rejects.toBeInstanceOf(OfferNotFoundError);
    await expect(
      brandProfileService.getByBrandId(orgId, soleOfferBrandId, randomUUID()),
    ).rejects.toBeInstanceOf(OfferNotFoundError);

    const foreign = await request(app)
      .get(runtimePath(twoOfferBrandId))
      .query({ offerId: soleOfferId })
      .set(getInternalAuthHeaders());
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('OFFER_NOT_FOUND');
  });

  it('400s a malformed offerId instead of reading it as "no offer named"', async () => {
    const res = await request(app)
      .get(runtimePath(twoOfferBrandId))
      .query({ offerId: 'not-a-uuid' })
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(400);
  });
});
