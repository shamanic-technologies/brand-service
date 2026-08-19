import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandSalesFunnels, brandUserFields } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  attachPairToOffer,
  readMigrationCandidates,
} from '../../src/services/offerMigrationService';
import { createOffer } from '../../src/services/brandOfferService';

/**
 * OFFERS — the granularity between Brand and Campaign.
 *
 * What this pins:
 *  - an offer is created, read, renamed and listed, and its name shape is the
 *    owner-fixed one (2 words, 20 chars, unique within the brand)
 *  - a SECOND offer on the same brand carries its OWN value proposition and its
 *    OWN funnels + economics, fully independent of the first
 *  - every pre-existing BRAND-scoped read answers exactly as it did before
 *    offers existed — both before the migration (rows carrying no offer) and
 *    after it (the brand's single offer), and it does not move when a second
 *    offer is added
 *  - the migration is idempotent: re-running finds nothing and changes nothing
 */
describe('Offers', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const otherOrgId = randomUUID();

  // Carries pre-offer config: the state production is in the day this ships.
  const legacyBrandId = randomUUID();
  // Starts empty; used for the offer CRUD and the two-independent-offers case.
  const brandId = randomUUID();
  const foreignBrandId = randomUUID();

  const createdBrandIds = [legacyBrandId, brandId, foreignBrandId];

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: legacyBrandId, url: 'https://offers-legacy.com', domain: 'offers-legacy.com', name: 'Offers Legacy' },
      { id: brandId, url: 'https://offers-main.com', domain: 'offers-main.com', name: 'Offers Main' },
      { id: foreignBrandId, url: 'https://offers-foreign.com', domain: 'offers-foreign.com', name: 'Offers Foreign' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId: legacyBrandId },
      { orgId, brandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);

    // Config stated BEFORE offers existed: no offer_id at all.
    await db.insert(brandUserFields).values([
      { orgId, brandId: legacyBrandId, fieldKey: 'dreamOutcome', value: 'More signed cases' },
      { orgId, brandId: legacyBrandId, fieldKey: 'services', value: 'SEO retainers' },
    ]);
    await db.insert(brandSalesFunnels).values([
      {
        orgId,
        brandId: legacyBrandId,
        funnelKey: 'sales_meetings_from_conversation',
        active: true,
        lifetimeRevenueUsd: 12345,
        replyToMeetingPct: 11,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, createdBrandIds));
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, createdBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, createdBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  });

  // ── The transitional contract, BEFORE the migration ──────────────────────

  it('answers the pre-existing brand-scoped reads with the pre-offer rows', async () => {
    const fields = await request(app)
      .get(`/orgs/brands/${legacyBrandId}/user-fields`)
      .set(getAuthHeaders(orgId));
    expect(fields.status).toBe(200);
    expect(fields.body.fields.dreamOutcome).toEqual({
      value: 'More signed cases',
      provenance: 'confirmed',
    });

    const funnels = await request(app)
      .get(`/orgs/brands/${legacyBrandId}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    expect(funnels.status).toBe(200);
    expect(funnels.body.funnels).toHaveLength(1);
    expect(funnels.body.funnels[0].lifetimeRevenueUsd).toBe(12345);
  });

  // ── The migration ────────────────────────────────────────────────────────

  it('moves a brand\'s stated config onto exactly ONE offer, byte-faithfully', async () => {
    const candidates = (await readMigrationCandidates()).filter((c) => c.brandId === legacyBrandId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].existingOfferId).toBeNull();
    // What the namer reads is what the brand SELLS.
    expect(candidates[0].valueProposition).toMatchObject({ services: 'SEO retainers' });
    expect(candidates[0].funnelNames).toEqual(['Sales Meeting from Conversation']);

    // The name is an LLM call in the script; the move itself is what is pinned here.
    const offer = await createOffer(orgId, legacyBrandId, 'SEO Retainer', {
      migratedFromBrandAt: new Date().toISOString(),
    });
    const moved = await attachPairToOffer(orgId, legacyBrandId, offer.id);
    expect(moved).toEqual({ fields: 2, funnels: 1 });

    // Byte-faithful: the brand-scoped reads answer with the SAME payload they
    // answered with before the move.
    const fields = await request(app)
      .get(`/orgs/brands/${legacyBrandId}/user-fields`)
      .set(getAuthHeaders(orgId));
    expect(fields.body.fields.dreamOutcome).toEqual({
      value: 'More signed cases',
      provenance: 'confirmed',
    });
    const funnels = await request(app)
      .get(`/orgs/brands/${legacyBrandId}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    expect(funnels.body.funnels).toHaveLength(1);
    expect(funnels.body.funnels[0].lifetimeRevenueUsd).toBe(12345);
    expect(funnels.body.funnels[0].rates.replyToMeetingPct).toBe(11);
  });

  it('re-running the migration finds nothing and changes nothing', async () => {
    const candidates = (await readMigrationCandidates()).filter((c) => c.brandId === legacyBrandId);
    expect(candidates).toHaveLength(0);
  });

  it('does not move the brand-scoped answer when a SECOND offer is added', async () => {
    const second = await request(app)
      .post(`/orgs/brands/${legacyBrandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Audit' });
    expect(second.status).toBe(201);

    const funnels = await request(app)
      .get(`/orgs/brands/${legacyBrandId}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    // Still the FIRST offer's single funnel, not a merge of both offers'.
    expect(funnels.body.funnels).toHaveLength(1);
    expect(funnels.body.funnels[0].lifetimeRevenueUsd).toBe(12345);
  });

  // ── Offer CRUD ───────────────────────────────────────────────────────────

  it('creates, reads, lists and renames an offer', async () => {
    const created = await request(app)
      .post(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Starter' });
    expect(created.status).toBe(201);
    expect(created.body.offer).toMatchObject({ brandId, orgId, name: 'Starter' });

    const read = await request(app)
      .get(`/orgs/offers/${created.body.offer.id}`)
      .set(getAuthHeaders(orgId));
    expect(read.status).toBe(200);
    expect(read.body.offer.name).toBe('Starter');

    const renamed = await request(app)
      .patch(`/orgs/offers/${created.body.offer.id}`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Self Serve' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.offer.name).toBe('Self Serve');

    const listed = await request(app)
      .get(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId));
    expect(listed.status).toBe(200);
    expect(listed.body.offers.map((o: { name: string }) => o.name)).toEqual(['Self Serve']);
  });

  it('refuses a name outside the owner-fixed shape, and a duplicate within the brand', async () => {
    const tooManyWords = await request(app)
      .post(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Done For You' });
    expect(tooManyWords.status).toBe(400);

    const duplicate = await request(app)
      .post(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'self serve' });
    expect(duplicate.status).toBe(409);
  });

  it("refuses an offer on another org's brand, and another org's offer", async () => {
    const onForeignBrand = await request(app)
      .post(`/orgs/brands/${foreignBrandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Sneaky' });
    expect(onForeignBrand.status).toBe(403);

    const mine = await request(app)
      .get(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId));
    const foreignRead = await request(app)
      .get(`/orgs/offers/${mine.body.offers[0].id}`)
      .set(getAuthHeaders(otherOrgId));
    expect(foreignRead.status).toBe(403);

    const unknown = await request(app)
      .get(`/orgs/offers/${randomUUID()}`)
      .set(getAuthHeaders(orgId));
    expect(unknown.status).toBe(404);
  });

  // ── Two offers, fully independent ────────────────────────────────────────

  it('gives a second offer its own value proposition and its own funnels + economics', async () => {
    const listed = await request(app)
      .get(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId));
    const first = listed.body.offers[0].id;

    const secondCreate = await request(app)
      .post(`/orgs/brands/${brandId}/offers`)
      .set(getAuthHeaders(orgId))
      .send({ name: 'Enterprise' });
    expect(secondCreate.status).toBe(201);
    const second = secondCreate.body.offer.id;

    // Same field key on both offers, different values — the old brand-scoped
    // uniqueness would have made this impossible.
    await request(app)
      .put(`/orgs/offers/${first}/user-fields`)
      .set(getAuthHeaders(orgId))
      .send({ fields: { dreamOutcome: 'Launch this week' } })
      .expect(200);
    await request(app)
      .put(`/orgs/offers/${second}/user-fields`)
      .set(getAuthHeaders(orgId))
      .send({ fields: { dreamOutcome: 'Replace your agency' } })
      .expect(200);

    const firstFields = await request(app)
      .get(`/orgs/offers/${first}/user-fields`)
      .set(getAuthHeaders(orgId));
    const secondFields = await request(app)
      .get(`/orgs/offers/${second}/user-fields`)
      .set(getAuthHeaders(orgId));
    expect(firstFields.body.fields.dreamOutcome.value).toBe('Launch this week');
    expect(secondFields.body.fields.dreamOutcome.value).toBe('Replace your agency');

    // Same funnel key on both offers, priced apart — a $200 self-serve plan and a
    // $20k enterprise contract are one brand and two sets of economics.
    await request(app)
      .put(`/orgs/offers/${first}/sales-funnels/website_purchases`)
      .set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 200, rates: { visitToSignupPct: 4 } })
      .expect(200);
    await request(app)
      .put(`/orgs/offers/${second}/sales-funnels/website_purchases`)
      .set(getAuthHeaders(orgId))
      .send({ lifetimeRevenueUsd: 20000, rates: { visitToSignupPct: 1 } })
      .expect(200);

    const firstFunnels = await request(app)
      .get(`/orgs/offers/${first}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    const secondFunnels = await request(app)
      .get(`/orgs/offers/${second}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    expect(firstFunnels.body.funnels).toHaveLength(1);
    expect(firstFunnels.body.funnels[0].lifetimeRevenueUsd).toBe(200);
    expect(secondFunnels.body.funnels).toHaveLength(1);
    expect(secondFunnels.body.funnels[0].lifetimeRevenueUsd).toBe(20000);

    // Switching the second offer's only funnel off is refused for the same
    // reason it always was, and it says nothing about the first offer's.
    const lastOff = await request(app)
      .delete(`/orgs/offers/${second}/sales-funnels/website_purchases`)
      .set(getAuthHeaders(orgId));
    expect(lastOff.status).toBe(400);

    // And the BRAND-scoped read still answers with the FIRST offer alone.
    const brandScoped = await request(app)
      .get(`/orgs/brands/${brandId}/sales-funnels`)
      .set(getAuthHeaders(orgId));
    expect(brandScoped.body.funnels).toHaveLength(1);
    expect(brandScoped.body.funnels[0].lifetimeRevenueUsd).toBe(200);
  });

  // ── Service-auth reads ───────────────────────────────────────────────────

  it('serves the offers and an offer\'s ACTIVE funnels to a service caller', async () => {
    const listed = await request(app)
      .get(`/internal/brands/${brandId}/offers`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', orgId);
    expect(listed.status).toBe(200);
    expect(listed.body.offers.map((o: { name: string }) => o.name)).toEqual([
      'Self Serve',
      'Enterprise',
    ]);

    const funnels = await request(app)
      .get(`/internal/offers/${listed.body.offers[1].id}/sales-funnels`)
      .set(getInternalAuthHeaders());
    expect(funnels.status).toBe(200);
    expect(funnels.body.funnels).toHaveLength(1);
    expect(funnels.body.funnels[0].lifetimeRevenueUsd).toBe(20000);
  });

  // ── The transitional WRITE path on a brand that never stated anything ────

  it('lands a brand-scoped write on an offer derived from the brand, when there is none', async () => {
    const bareBrandId = randomUUID();
    createdBrandIds.push(bareBrandId);
    await db
      .insert(brands)
      .values({ id: bareBrandId, url: 'https://offers-bare.com', domain: 'offers-bare.com', name: 'Bare Business' });
    await db.insert(orgBrands).values({ orgId, brandId: bareBrandId });

    const written = await request(app)
      .put(`/orgs/brands/${bareBrandId}/user-fields`)
      .set(getAuthHeaders(orgId))
      .send({ fields: { dreamOutcome: 'Something new' } });
    expect(written.status).toBe(200);
    expect(written.body.fields.dreamOutcome.value).toBe('Something new');

    const offers = await request(app)
      .get(`/orgs/brands/${bareBrandId}/offers`)
      .set(getAuthHeaders(orgId));
    expect(offers.body.offers).toHaveLength(1);
    // Derived from the brand's own name — never invented, and never an LLM call
    // on a request path.
    expect(offers.body.offers[0].name).toBe('Bare Business');
  });

  it('rejects a bad brand-scoped write WITHOUT auto-creating an offer for it', async () => {
    const untouchedBrandId = randomUUID();
    createdBrandIds.push(untouchedBrandId);
    await db.insert(brands).values({
      id: untouchedBrandId,
      url: 'https://offers-untouched.com',
      domain: 'offers-untouched.com',
      name: 'Untouched Co',
    });
    await db.insert(orgBrands).values({ orgId, brandId: untouchedBrandId });

    const rejected = await request(app)
      .put(`/orgs/brands/${untouchedBrandId}/user-fields`)
      .set(getAuthHeaders(orgId))
      .send({ fields: { notAField: 'x' } });
    expect(rejected.status).toBe(400);

    const offers = await request(app)
      .get(`/orgs/brands/${untouchedBrandId}/offers`)
      .set(getAuthHeaders(orgId));
    expect(offers.body.offers).toHaveLength(0);
  });
});
