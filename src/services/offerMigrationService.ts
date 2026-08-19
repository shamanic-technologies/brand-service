import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, brandOffers, brandSalesFunnels, brandUserFields } from '../db';
import { salesFunnelByKey, type SalesFunnelKey } from './salesFunnelCatalogue';

/**
 * The ONE-TIME move of brand-scoped config onto offers.
 *
 * Before offers, an org stated its value proposition and its declared funnels on
 * the BRAND. Every (org, brand) pair that stated either ends up with exactly ONE
 * offer carrying all of it, byte-faithful: not a value is rewritten, defaulted or
 * dropped — only `offer_id` is filled in.
 *
 * IDEMPOTENT by construction: a candidate is a pair that still holds at least one
 * row with `offer_id IS NULL`, so a second run finds none.
 * REVERSIBLE by an exact predicate on the provenance column — see the script.
 * DRY-RUNNABLE: the plan is read and printed with nothing written.
 *
 * A pair that ALREADY has an offer (a user created one, or a transitional write
 * auto-created one) does not get a second: its unmoved rows are attached to its
 * EARLIEST offer, which is the one the brand-scoped surface already answers with,
 * so nothing a consumer reads changes. Only a pair with no offer at all is named.
 */

export interface OfferMigrationCandidate {
  orgId: string;
  brandId: string;
  /** Confirmed value-proposition fields still on the brand, key → value. */
  valueProposition: Record<string, unknown>;
  /** Human names of the funnels still on the brand, in catalogue order. */
  funnelNames: string[];
  fieldRowCount: number;
  funnelRowCount: number;
  /**
   * The offer the unmoved rows attach to when the pair already has one. `null`
   * means the pair has none, so one must be created — and NAMED.
   */
  existingOfferId: string | null;
  /** Names already on this brand, so a new one does not collide. */
  takenNames: string[];
}

/**
 * Every (org, brand) pair still holding config that predates offers, with what
 * it sells — which is what the namer reads. Ordered so two runs plan alike.
 */
export async function readMigrationCandidates(): Promise<OfferMigrationCandidate[]> {
  const fieldRows = await db
    .select({
      orgId: brandUserFields.orgId,
      brandId: brandUserFields.brandId,
      fieldKey: brandUserFields.fieldKey,
      value: brandUserFields.value,
    })
    .from(brandUserFields)
    .where(isNull(brandUserFields.offerId))
    .orderBy(asc(brandUserFields.orgId), asc(brandUserFields.brandId), asc(brandUserFields.fieldKey));

  const funnelRows = await db
    .select({
      orgId: brandSalesFunnels.orgId,
      brandId: brandSalesFunnels.brandId,
      funnelKey: brandSalesFunnels.funnelKey,
    })
    .from(brandSalesFunnels)
    .where(isNull(brandSalesFunnels.offerId))
    .orderBy(asc(brandSalesFunnels.orgId), asc(brandSalesFunnels.brandId), asc(brandSalesFunnels.funnelKey));

  const byPair = new Map<string, OfferMigrationCandidate>();
  const pairKey = (orgId: string, brandId: string) => `${orgId}::${brandId}`;

  const ensure = (orgId: string, brandId: string): OfferMigrationCandidate => {
    const key = pairKey(orgId, brandId);
    let candidate = byPair.get(key);
    if (!candidate) {
      candidate = {
        orgId,
        brandId,
        valueProposition: {},
        funnelNames: [],
        fieldRowCount: 0,
        funnelRowCount: 0,
        existingOfferId: null,
        takenNames: [],
      };
      byPair.set(key, candidate);
    }
    return candidate;
  };

  for (const row of fieldRows) {
    const candidate = ensure(row.orgId, row.brandId);
    candidate.valueProposition[row.fieldKey] = row.value;
    candidate.fieldRowCount += 1;
  }
  for (const row of funnelRows) {
    const candidate = ensure(row.orgId, row.brandId);
    // The catalogue owns the human name; a key it does not know fails loud there
    // rather than being described as itself.
    candidate.funnelNames.push(salesFunnelByKey(row.funnelKey as SalesFunnelKey).name);
    candidate.funnelRowCount += 1;
  }

  // Whatever each pair already has, so an existing offer is reused and a new name
  // never collides.
  for (const candidate of byPair.values()) {
    const offers = await db
      .select({ id: brandOffers.id, name: brandOffers.name })
      .from(brandOffers)
      .where(and(eq(brandOffers.orgId, candidate.orgId), eq(brandOffers.brandId, candidate.brandId)))
      .orderBy(asc(brandOffers.createdAt), asc(brandOffers.id));
    candidate.existingOfferId = offers[0]?.id ?? null;
    candidate.takenNames = offers.map((o) => o.name);
  }

  return [...byPair.values()].sort((a, b) =>
    a.orgId === b.orgId ? a.brandId.localeCompare(b.brandId) : a.orgId.localeCompare(b.orgId)
  );
}

/**
 * Move one pair's unmoved rows onto `offerId`. Only `offer_id` is written — every
 * value the customer stated is left exactly as stored — and the `offer_id IS
 * NULL` predicate is repeated in the UPDATE so a row moved between the read and
 * the write is not moved twice.
 */
export async function attachPairToOffer(
  orgId: string,
  brandId: string,
  offerId: string
): Promise<{ fields: number; funnels: number }> {
  const fields = await db
    .update(brandUserFields)
    .set({ offerId })
    .where(
      and(
        eq(brandUserFields.orgId, orgId),
        eq(brandUserFields.brandId, brandId),
        isNull(brandUserFields.offerId)
      )
    )
    .returning({ id: brandUserFields.id });

  const funnels = await db
    .update(brandSalesFunnels)
    .set({ offerId })
    .where(
      and(
        eq(brandSalesFunnels.orgId, orgId),
        eq(brandSalesFunnels.brandId, brandId),
        isNull(brandSalesFunnels.offerId)
      )
    )
    .returning({ funnelKey: brandSalesFunnels.funnelKey });

  return { fields: fields.length, funnels: funnels.length };
}

/**
 * Read the result back independently of the script's own log: how many offers
 * the migration created, and how many rows still carry no offer.
 */
export async function readMigrationState(): Promise<{
  migratedOffers: number;
  unmovedFieldRows: number;
  unmovedFunnelRows: number;
}> {
  const [offers] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brandOffers)
    .where(sql`${brandOffers.migratedFromBrandAt} IS NOT NULL`);
  const [fields] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brandUserFields)
    .where(isNull(brandUserFields.offerId));
  const [funnels] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brandSalesFunnels)
    .where(isNull(brandSalesFunnels.offerId));

  return {
    migratedOffers: offers?.count ?? 0,
    unmovedFieldRows: fields?.count ?? 0,
    unmovedFunnelRows: funnels?.count ?? 0,
  };
}
