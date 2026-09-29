import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { inArray, eq } from 'drizzle-orm';
import { db, brands, orgBrands, brandOffers } from '../../src/db';
import { getBrand } from '../../src/services/fieldExtractionService';
import { OfferNotFoundError } from '../../src/services/brandOffersService';

/**
 * A brand claimed by several orgs (an anonymous onboarding org first, the
 * customer's real org later) holds its offers under ONE of them. An org-less
 * (platform-mode) extraction that names an offer must run under the org that
 * owns the offer, not the oldest claim — otherwise every internal call naming
 * that offer 404s (brand-service#578, brand Olive).
 */
describe('getBrand: the named offer decides the org', () => {
  const brandId = randomUUID();
  const oldestOrg = randomUUID();
  const offerOrg = randomUUID();
  let offerId = '';

  beforeAll(async () => {
    await db.insert(brands).values({
      id: brandId,
      url: `https://offerorg-${brandId.slice(0, 8)}.com`,
      domain: `offerorg-${brandId.slice(0, 8)}.com`,
      name: 'Offer Org Brand',
    });
    await db.insert(orgBrands).values({ orgId: oldestOrg, brandId, claimedAt: new Date('2026-01-01').toISOString() });
    await db.insert(orgBrands).values({ orgId: offerOrg, brandId, claimedAt: new Date('2026-02-01').toISOString() });
    const [row] = await db
      .insert(brandOffers)
      .values({ orgId: offerOrg, brandId, name: 'Liquidity Pool' })
      .returning({ id: brandOffers.id });
    offerId = row.id;
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(eq(brandOffers.brandId, brandId));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('without an offer, keeps the oldest claim (unchanged)', async () => {
    expect((await getBrand(brandId))!.orgId).toBe(oldestOrg);
  });

  it('with an offer, uses the org that owns it', async () => {
    expect((await getBrand(brandId, offerId))!.orgId).toBe(offerOrg);
  });

  it('with an offer that is not on this brand, fails loud', async () => {
    await expect(getBrand(brandId, randomUUID())).rejects.toBeInstanceOf(OfferNotFoundError);
  });
});
