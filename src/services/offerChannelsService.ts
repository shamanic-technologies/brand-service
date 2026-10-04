import { eq } from 'drizzle-orm';
import { db, brandOfferChannels } from '../db';
import { assertOfferOnBrand } from './brandOffersService';

/**
 * WHICH CHANNELS AN OFFER ACCEPTS, as the customer states it: features-service
 * channel slugs (e.g. `sales-cold-email-outreach`), stored AS GIVEN (no
 * validation against the features-service catalogue).
 *
 * `stated: false` (`channelSlugs: null`) = the offer never stated any, a
 * different answer from `stated: true` with an empty list. What "never stated"
 * means (today: the channels we run) is the CONSUMER's default, never written
 * here.
 */
export interface OfferChannelsView {
  offerId: string;
  stated: boolean;
  channelSlugs: string[] | null;
  statedAt: string | null;
  statedByUserId: string | null;
}

async function readRow(offerId: string): Promise<OfferChannelsView> {
  const [row] = await db
    .select()
    .from(brandOfferChannels)
    .where(eq(brandOfferChannels.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, channelSlugs: null, statedAt: null, statedByUserId: null };
  return {
    offerId,
    stated: true,
    channelSlugs: row.channelSlugs,
    statedAt: row.statedAt,
    statedByUserId: row.statedByUserId,
  };
}

/** Throws `OfferNotFoundError` when the offer is not on this (org, brand). */
export async function readOfferChannels(orgId: string, brandId: string, offerId: string): Promise<OfferChannelsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return readRow(offerId);
}

/** Read keyed on the offer alone, for a service holding only the offer id. */
export async function readOfferChannelsByOffer(offerId: string): Promise<OfferChannelsView> {
  return readRow(offerId);
}

/** Replace the offer's whole channel list, then read it back. */
export async function writeOfferChannels(
  orgId: string,
  brandId: string,
  offerId: string,
  channelSlugs: string[],
  userId: string | null
): Promise<OfferChannelsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const now = new Date().toISOString();
  await db
    .insert(brandOfferChannels)
    .values({ offerId, channelSlugs, statedAt: now, statedByUserId: userId })
    .onConflictDoUpdate({
      target: brandOfferChannels.offerId,
      set: { channelSlugs, statedAt: now, statedByUserId: userId },
    });
  return readRow(offerId);
}
