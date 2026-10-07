import { eq } from 'drizzle-orm';
import { db, brandOfferSelectedSourcingOrigins } from '../db';
import { assertOfferOnBrand } from './brandOffersService';

/**
 * WHICH SOURCING ORIGINS THE CUSTOMER SELECTED on an offer: features-service
 * sourcing origin slugs (e.g. `sourcing-apollo-cold-filters`,
 * `sourcing-linkedin-engagement-signals`), stored AS GIVEN (no validation
 * against the features-service catalogue).
 *
 * A plain stated list, modelled on `offerSelectedSalesPathsService`: no
 * uniqueness, no history, no money.
 *
 * `stated: false` (`originSlugs: null`) = the offer never stated any, a
 * different answer from `stated: true` with an empty list. What "never stated"
 * means (today: the dashboard pre-ticks origins above 1x ROI) is the CONSUMER's
 * default, never written here.
 */
export interface OfferSelectedSourcingOriginsView {
  offerId: string;
  stated: boolean;
  originSlugs: string[] | null;
  statedAt: string | null;
  statedByUserId: string | null;
}

async function readRow(offerId: string): Promise<OfferSelectedSourcingOriginsView> {
  const [row] = await db
    .select()
    .from(brandOfferSelectedSourcingOrigins)
    .where(eq(brandOfferSelectedSourcingOrigins.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, originSlugs: null, statedAt: null, statedByUserId: null };
  return {
    offerId,
    stated: true,
    originSlugs: row.originSlugs,
    statedAt: row.statedAt,
    statedByUserId: row.statedByUserId,
  };
}

/** Throws `OfferNotFoundError` when the offer is not on this (org, brand). */
export async function readOfferSelectedSourcingOrigins(
  orgId: string,
  brandId: string,
  offerId: string
): Promise<OfferSelectedSourcingOriginsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return readRow(offerId);
}

/** Read keyed on the offer alone, for a service holding only the offer id. */
export async function readOfferSelectedSourcingOriginsByOffer(offerId: string): Promise<OfferSelectedSourcingOriginsView> {
  return readRow(offerId);
}

/** Replace the offer's whole selected-origin list, then read it back. */
export async function writeOfferSelectedSourcingOrigins(
  orgId: string,
  brandId: string,
  offerId: string,
  originSlugs: string[],
  userId: string | null
): Promise<OfferSelectedSourcingOriginsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const now = new Date().toISOString();
  await db
    .insert(brandOfferSelectedSourcingOrigins)
    .values({ offerId, originSlugs, statedAt: now, statedByUserId: userId })
    .onConflictDoUpdate({
      target: brandOfferSelectedSourcingOrigins.offerId,
      set: { originSlugs, statedAt: now, statedByUserId: userId },
    });
  return readRow(offerId);
}
