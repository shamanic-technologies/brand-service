import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandSalesFunnels, brandUserFields } from '../../src/db';

/**
 * OFFERS — the level between a brand and a campaign.
 *
 * Three properties carry the whole design and are what these tests pin:
 *   - a second offer is FULLY INDEPENDENT: its own funnels, its own rates, its
 *     own lifetime revenue, its own value proposition, on the same brand;
 *   - every BRAND-scoped route keeps working unchanged while a brand holds one
 *     offer, and REFUSES 409 rather than guessing once it holds several;
 *   - a brand-scoped WRITE on a brand with no offer creates its first one, which
 *     is what keeps onboarding working the day this ships.
 *
 * There is NO PRIMARY OFFER: several run at once and none outranks another.
 */
describe('Offers', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const legacyBrandId = randomUUID(); // exercises the implicit first offer
  const foreignBrandId = randomUUID();
  const allBrandIds = [brandId, legacyBrandId, foreignBrandId];

  const dom = (id: string) => `offers-${id.slice(0, 8)}.com`;
  const offersPath = (id: string) => `/orgs/brands/${id}/offers`;

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Offer Brand' },
      {
        id: legacyBrandId,
        url: `https://${dom(legacyBrandId)}`,
        domain: dom(legacyBrandId),
        name: 'Legacy Brand',
      },
      {
        id: foreignBrandId,
        url: `https://${dom(foreignBrandId)}`,
        domain: dom(foreignBrandId),
        name: 'Foreign Brand',
      },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: legacyBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, allBrandIds));
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  // ── The name limits ───────────────────────────────────────────────────────

  describe('the name', () => {
    it('accepts two words and twenty characters', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: 'Self Serve' });

      expect(res.status).toBe(201);
      expect(res.body.offer.name).toBe('Self Serve');
      expect(res.body.offer.brandId).toBe(brandId);
      expect(res.body.offer.offerId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses a third word', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: 'Self Serve Plan' });
      expect(res.status).toBe(400);
    });

    it('refuses more than twenty characters', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: 'Enterprisee Contracts' });
      expect(res.status).toBe(400);
    });

    it('refuses an empty name', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: '   ' });
      expect(res.status).toBe(400);
    });

    it('refuses a name already used on this brand, rather than suffixing a number', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: 'Self Serve' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('OFFER_NAME_TAKEN');
    });

    it('stores the collapsed form, so two names cannot differ only by whitespace', async () => {
      const res = await request(app)
        .post(offersPath(brandId))
        .set(getAuthHeaders(orgId))
        .send({ name: '  Enterprise  ' });
      expect(res.status).toBe(201);
      expect(res.body.offer.name).toBe('Enterprise');
    });
  });

  // ── Two offers, fully independent ─────────────────────────────────────────

  describe('a second offer is independent of the first', () => {
    let selfServeId = '';
    let enterpriseId = '';

    it('lists both, in a stable order that implies no rank', async () => {
      const res = await request(app).get(offersPath(brandId)).set(getAuthHeaders(orgId));
      expect(res.status).toBe(200);
      expect(res.body.offers.map((o: { name: string }) => o.name)).toEqual([
        'Self Serve',
        'Enterprise',
      ]);
      // Nothing on the wire marks one as primary — there is no primary offer.
      expect(JSON.stringify(res.body)).not.toContain('primary');

      selfServeId = res.body.offers[0].offerId;
      enterpriseId = res.body.offers[1].offerId;
    });

    it('prices the SAME funnel completely differently on each offer', async () => {
      const declare = (offerId: string, lifetimeRevenueUsd: number, rate: number) =>
        request(app)
          .put(`${offersPath(brandId)}/${offerId}/sales-funnels/website_purchases`)
          .set(getAuthHeaders(orgId))
          .send({
            lifetimeRevenueUsd,
            rates: { visitToSignupPct: rate },
          });

      expect((await declare(selfServeId, 200, 8.4)).status).toBe(200);
      expect((await declare(enterpriseId, 20000, 0.4)).status).toBe(200);

      const selfServe = await request(app)
        .get(`${offersPath(brandId)}/${selfServeId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      const enterprise = await request(app)
        .get(`${offersPath(brandId)}/${enterpriseId}/sales-funnels`)
        .set(getAuthHeaders(orgId));

      expect(selfServe.body.funnels).toHaveLength(1);
      expect(selfServe.body.funnels[0].lifetimeRevenueUsd).toBe(200);
      expect(selfServe.body.funnels[0].rates.visitToSignupPct).toBe(8.4);

      expect(enterprise.body.funnels).toHaveLength(1);
      expect(enterprise.body.funnels[0].lifetimeRevenueUsd).toBe(20000);
      expect(enterprise.body.funnels[0].rates.visitToSignupPct).toBe(0.4);
    });

    it('carries its OWN value proposition under the same key', async () => {
      await request(app)
        .put(`${offersPath(brandId)}/${selfServeId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { dreamOutcome: 'Ship in an afternoon' } });
      await request(app)
        .put(`${offersPath(brandId)}/${enterpriseId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { dreamOutcome: 'Cut procurement risk' } });

      const selfServe = await request(app)
        .get(`${offersPath(brandId)}/${selfServeId}/user-fields`)
        .set(getAuthHeaders(orgId));
      const enterprise = await request(app)
        .get(`${offersPath(brandId)}/${enterpriseId}/user-fields`)
        .set(getAuthHeaders(orgId));

      expect(selfServe.body.fields.dreamOutcome).toEqual({
        value: 'Ship in an afternoon',
        provenance: 'confirmed',
      });
      expect(enterprise.body.fields.dreamOutcome).toEqual({
        value: 'Cut procurement risk',
        provenance: 'confirmed',
      });
    });

    it('switches a funnel off on one offer without touching the other', async () => {
      // Declaring a second funnel first: the last active one cannot be switched off.
      await request(app)
        .put(`${offersPath(brandId)}/${selfServeId}/sales-funnels/form_magnet`)
        .set(getAuthHeaders(orgId))
        .send({});

      const off = await request(app)
        .delete(`${offersPath(brandId)}/${selfServeId}/sales-funnels/website_purchases`)
        .set(getAuthHeaders(orgId));
      expect(off.status).toBe(200);
      expect(
        off.body.funnels.find((f: { funnelKey: string }) => f.funnelKey === 'website_purchases').active
      ).toBe(false);

      const enterprise = await request(app)
        .get(`${offersPath(brandId)}/${enterpriseId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(enterprise.body.funnels[0].active).toBe(true);
      expect(enterprise.body.funnels[0].lifetimeRevenueUsd).toBe(20000);
    });

    it('renames one without changing anything else about it', async () => {
      const res = await request(app)
        .patch(`${offersPath(brandId)}/${enterpriseId}`)
        .set(getAuthHeaders(orgId))
        .send({ name: 'Contracts' });
      expect(res.status).toBe(200);
      expect(res.body.offer.name).toBe('Contracts');

      const funnels = await request(app)
        .get(`${offersPath(brandId)}/${enterpriseId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(funnels.body.funnels[0].lifetimeRevenueUsd).toBe(20000);
    });

    it('serves one offer\'s ACTIVE funnels to a service that holds only the offer id', async () => {
      const res = await request(app)
        .get(`/internal/offers/${enterpriseId}/sales-funnels`)
        .set(getInternalAuthHeaders());
      expect(res.status).toBe(200);
      expect(res.body.funnels).toHaveLength(1);
      expect(res.body.funnels[0].funnelKey).toBe('website_purchases');
    });

    it('404s an offer id that names nothing', async () => {
      const res = await request(app)
        .get(`/internal/offers/${randomUUID()}/sales-funnels`)
        .set(getInternalAuthHeaders());
      expect(res.status).toBe(404);
    });
  });

  // ── The back-compat contract ──────────────────────────────────────────────

  describe('a BRAND-scoped call against a brand selling several offers', () => {
    it('REFUSES the read 409 rather than answering for one of them', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${brandId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SEVERAL_OFFERS');
      expect(res.body.offers).toHaveLength(2);
    });

    it('REFUSES the write 409 rather than writing over one of them', async () => {
      const res = await request(app)
        .put(`/orgs/brands/${brandId}/sales-funnels/form_magnet`)
        .set(getAuthHeaders(orgId))
        .send({ lifetimeRevenueUsd: 999 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SEVERAL_OFFERS');
    });

    it('REFUSES the user-fields write 409 too', async () => {
      const res = await request(app)
        .put(`/orgs/brands/${brandId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { urgency: 'Ends Friday' } });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SEVERAL_OFFERS');
    });

    it('names the offers and the route to use, so the caller can act on the refusal', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${brandId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(res.body.error).toContain('/orgs/brands/{brandId}/offers/{offerId}');
      expect(res.body.offers.map((o: { name: string }) => o.name).sort()).toEqual([
        'Contracts',
        'Self Serve',
      ]);
    });
  });

  describe('a brand that has never heard of offers', () => {
    it('reads its funnels exactly as it always did — an empty set, not an error', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${legacyBrandId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(res.status).toBe(200);
      expect(res.body.funnels).toEqual([]);
    });

    it("creates its FIRST offer on a brand-scoped write, named after the brand's own words", async () => {
      const res = await request(app)
        .put(`/orgs/brands/${legacyBrandId}/sales-funnels/website_purchases`)
        .set(getAuthHeaders(orgId))
        .send({ lifetimeRevenueUsd: 1200 });
      expect(res.status).toBe(200);

      const offers = await request(app).get(offersPath(legacyBrandId)).set(getAuthHeaders(orgId));
      expect(offers.body.offers).toHaveLength(1);
      expect(offers.body.offers[0].name).toBe('Legacy Brand');
    });

    it('keeps reading through the brand-scoped route while it holds one offer', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${legacyBrandId}/sales-funnels`)
        .set(getAuthHeaders(orgId));
      expect(res.status).toBe(200);
      expect(res.body.funnels).toHaveLength(1);
      expect(res.body.funnels[0].lifetimeRevenueUsd).toBe(1200);
    });

    it('does NOT create a second offer on the next brand-scoped write', async () => {
      await request(app)
        .put(`/orgs/brands/${legacyBrandId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { urgency: 'Ends Friday' } });

      const offers = await request(app).get(offersPath(legacyBrandId)).set(getAuthHeaders(orgId));
      expect(offers.body.offers).toHaveLength(1);
    });
  });

  // ── Scoping ───────────────────────────────────────────────────────────────

  describe('ownership and ids', () => {
    it('403s a brand outside the org', async () => {
      const res = await request(app).get(offersPath(foreignBrandId)).set(getAuthHeaders(orgId));
      expect(res.status).toBe(403);
    });

    it('404s an unknown brand', async () => {
      const res = await request(app).get(offersPath(randomUUID())).set(getAuthHeaders(orgId));
      expect(res.status).toBe(404);
    });

    it('400s a brand id that is not a uuid', async () => {
      const res = await request(app).get(offersPath('not-a-uuid')).set(getAuthHeaders(orgId));
      expect(res.status).toBe(400);
    });

    it("404s an offer id that belongs to no offer of this brand", async () => {
      const res = await request(app)
        .get(`${offersPath(brandId)}/${randomUUID()}`)
        .set(getAuthHeaders(orgId));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('OFFER_NOT_FOUND');
    });

    it('serves the offers of a brand to a service that holds only the brand id', async () => {
      const res = await request(app)
        .get(`/internal/brands/${legacyBrandId}/offers`)
        .set(getInternalAuthHeaders());
      expect(res.status).toBe(200);
      expect(res.body.offers).toHaveLength(1);
    });
  });
});
