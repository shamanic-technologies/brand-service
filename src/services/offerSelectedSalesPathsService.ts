import { eq } from 'drizzle-orm';
import { db, brandOfferSelectedSalesPaths } from '../db';
import { assertOfferOnBrand } from './brandOffersService';

/**
 * WHICH SALES PATHS THE CUSTOMER SELECTED on an offer: features-service
 * combinationKeys (e.g.
 * `start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@ai-meeting-booking`),
 * stored AS GIVEN (no validation against the features-service catalogue).
 *
 * A plain stated list, modelled on `offerChannelsService`. NOT an activation:
 * no uniqueness across paths (several may share a campaign), no history, no
 * money (budgets are billing-service's).
 *
 * `stated: false` (`combinationKeys: null`) = the offer never stated any, a
 * different answer from `stated: true` with an empty list. What "never stated"
 * means (today: the dashboard pre-ticks paths above 1x ROI) is the CONSUMER's
 * default, never written here.
 */
export interface OfferSelectedSalesPathsView {
  offerId: string;
  stated: boolean;
  combinationKeys: string[] | null;
  statedAt: string | null;
  statedByUserId: string | null;
}

async function readRow(offerId: string): Promise<OfferSelectedSalesPathsView> {
  const [row] = await db
    .select()
    .from(brandOfferSelectedSalesPaths)
    .where(eq(brandOfferSelectedSalesPaths.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, combinationKeys: null, statedAt: null, statedByUserId: null };
  return {
    offerId,
    stated: true,
    combinationKeys: row.combinationKeys,
    statedAt: row.statedAt,
    statedByUserId: row.statedByUserId,
  };
}

/** Throws `OfferNotFoundError` when the offer is not on this (org, brand). */
export async function readOfferSelectedSalesPaths(
  orgId: string,
  brandId: string,
  offerId: string
): Promise<OfferSelectedSalesPathsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return readRow(offerId);
}

/** Read keyed on the offer alone, for a service holding only the offer id. */
export async function readOfferSelectedSalesPathsByOffer(offerId: string): Promise<OfferSelectedSalesPathsView> {
  return readRow(offerId);
}

/** Replace the offer's whole selected-path list, then read it back. */
export async function writeOfferSelectedSalesPaths(
  orgId: string,
  brandId: string,
  offerId: string,
  combinationKeys: string[],
  userId: string | null
): Promise<OfferSelectedSalesPathsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const now = new Date().toISOString();
  await db
    .insert(brandOfferSelectedSalesPaths)
    .values({ offerId, combinationKeys, statedAt: now, statedByUserId: userId })
    .onConflictDoUpdate({
      target: brandOfferSelectedSalesPaths.offerId,
      set: { combinationKeys, statedAt: now, statedByUserId: userId },
    });
  return readRow(offerId);
}
