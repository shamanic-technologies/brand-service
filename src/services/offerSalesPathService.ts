import { eq } from 'drizzle-orm';
import { db, brandOfferSalesPaths } from '../db';
import { assertOfferOnBrand } from './brandOffersService';
import { toNewSalesPathLegKeys } from '../lib/outbound-leg-keys';

/**
 * HOW AN OFFER SELLS, as the customer states it: the funnel steps it goes
 * through and the legs between them that apply. Identifiers are
 * features-service's step keys and leg keys, stored AS GIVEN (no validation
 * against the features-service catalogue in this phase), except that an
 * outbound entry leg is stored and served in its NEW spelling
 * (`lead_found_to_*`, wave 2; the legacy `start_to_*` is accepted on input).
 *
 * `stated: false` (both lists null) = the offer never stated anything, a
 * different answer from `stated: true` with two empty lists.
 */
export interface OfferSalesPathView {
  offerId: string;
  stated: boolean;
  steps: string[] | null;
  legKeys: string[] | null;
  statedAt: string | null;
}

async function readRow(offerId: string): Promise<OfferSalesPathView> {
  const [row] = await db
    .select()
    .from(brandOfferSalesPaths)
    .where(eq(brandOfferSalesPaths.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, steps: null, legKeys: null, statedAt: null };
  return { offerId, stated: true, steps: row.steps, legKeys: toNewSalesPathLegKeys(row.legKeys), statedAt: row.statedAt };
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

/** Replace the offer's whole selection (both lists), then read it back. */
export async function writeOfferSalesPath(
  orgId: string,
  brandId: string,
  offerId: string,
  selection: { steps: string[]; legKeys: string[] }
): Promise<OfferSalesPathView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const now = new Date().toISOString();
  const legKeys = toNewSalesPathLegKeys(selection.legKeys);
  await db
    .insert(brandOfferSalesPaths)
    .values({ offerId, steps: selection.steps, legKeys, statedAt: now })
    .onConflictDoUpdate({
      target: brandOfferSalesPaths.offerId,
      set: { steps: selection.steps, legKeys, statedAt: now },
    });
  return readRow(offerId);
}
