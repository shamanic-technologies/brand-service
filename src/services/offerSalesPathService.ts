import { eq } from 'drizzle-orm';
import { db, brandOfferSalesPaths } from '../db';
import { assertOfferOnBrand } from './brandOffersService';
import {
  type SalesPathLeg,
  bareLegKeys,
  formatSalesPathLeg,
  legsFromLegacyLegKeys,
  normalizeSalesPathLegs,
  parseSalesPathLeg,
} from '../lib/outbound-leg-keys';

/**
 * HOW AN OFFER SELLS, as the customer states it: the funnel steps it goes
 * through and the legs between them that apply, EACH LEG WITH THE CHANNEL
 * (features-service feature slug) THAT PERFORMS IT (owner 2026-10-09). An offer
 * selling through Google Ads AND cold email holds both "website visit" legs,
 * `start_to_website_visit@google-ads` and
 * `lead_found_to_website_visit@sales-cold-email-outreach`, side by side.
 *
 * Identifiers are features-service's step keys, leg keys and feature slugs,
 * stored AS GIVEN (no validation against its catalogue), except that an
 * outbound leg is stored and served in its NEW spelling (`lead_found_to_*`).
 * An ENTRY leg must name its channel (`EntryLegWithoutChannelError`); a later
 * leg may name none.
 *
 * Served: `legs` (with channel) and `legKeys`, the bare projection every
 * existing reader consumes. `stated: false` (every list null) = the offer never
 * stated anything, a different answer from `stated: true` with empty lists.
 */
export interface OfferSalesPathView {
  offerId: string;
  stated: boolean;
  steps: string[] | null;
  legKeys: string[] | null;
  legs: SalesPathLeg[] | null;
  statedAt: string | null;
}

async function readRow(offerId: string): Promise<OfferSalesPathView> {
  const [row] = await db
    .select()
    .from(brandOfferSalesPaths)
    .where(eq(brandOfferSalesPaths.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, steps: null, legKeys: null, legs: null, statedAt: null };
  // `legs` NULL = a row the pre-0092 container wrote during the deploy swap: read
  // with the rule migration 0092 applied to every stored row (legacy shape).
  const legs = normalizeSalesPathLegs(
    row.legs === null ? legsFromLegacyLegKeys(row.legKeys) : row.legs.map(parseSalesPathLeg)
  );
  return { offerId, stated: true, steps: row.steps, legKeys: bareLegKeys(legs), legs, statedAt: row.statedAt };
}

/** The offer's selection. Throws `OfferNotFoundError` when the offer is not on this (org, brand). */
export async function readOfferSalesPath(
  orgId: string,
  brandId: string,
  offerId: string
): Promise<OfferSalesPathView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return readRow(offerId);
}

/** Read keyed on the offer alone, for a service holding only the offer id. */
export async function readOfferSalesPathByOffer(offerId: string): Promise<OfferSalesPathView> {
  return readRow(offerId);
}

/**
 * Replace the offer's whole selection, then read it back. Throws
 * `EntryLegWithoutChannelError` (nothing written) when an entry leg names no channel.
 */
export async function writeOfferSalesPath(
  orgId: string,
  brandId: string,
  offerId: string,
  selection: { steps: string[]; legs: SalesPathLeg[] }
): Promise<OfferSalesPathView> {
  const normalized = normalizeSalesPathLegs(selection.legs);
  await assertOfferOnBrand(orgId, brandId, offerId);
  const now = new Date().toISOString();
  const legs = normalized.map(formatSalesPathLeg);
  const legKeys = bareLegKeys(normalized);
  await db
    .insert(brandOfferSalesPaths)
    .values({ offerId, steps: selection.steps, legKeys, legs, statedAt: now })
    .onConflictDoUpdate({
      target: brandOfferSalesPaths.offerId,
      set: { steps: selection.steps, legKeys, legs, statedAt: now },
    });
  return readRow(offerId);
}
