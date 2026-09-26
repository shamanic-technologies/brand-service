import { and, asc, eq } from 'drizzle-orm';
import { db, brandLegRates, brandOffers } from '../db';
import { LegRateView, StoredLegRate, buildLegRatesView, legIdentity } from '../lib/brand-leg-rates';
import { assertOfferOnBrand } from './brandOffersService';

/**
 * LEG-GRAIN rates and PER-OFFER lifetime revenue — the economics a brand states.
 *
 * - A rate is stated per (org, brand, leg): `brand_leg_rates`. Shared by every
 *   offer of the brand (the owner's brand-grain decision of 2026-09-25).
 * - A lifetime revenue is stated per offer: `brand_offers.lifetime_revenue_usd`.
 *
 * These are the only doors: the funnel-keyed ones that used to mirror onto them
 * were deleted with the sales funnel (wave C2, distribute.you#4413).
 */

/** A rate stated for one leg. `ratePct` null CLEARS the statement. */
export interface LegRatePatch {
  fromStep: string;
  toStep: string;
  ratePct: number | null;
}

/** Thrown when a leg names nothing a leg can be, or is stated twice (→ 400). */
export class LegRateInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegRateInvalidError';
  }
}

/**
 * Reject a leg that cannot identify one. Deliberately NOT checked against a
 * known list: a leg this service has not learned yet is accepted and stored.
 * Only an empty step or a step pointing at itself is refused.
 */
function assertLegIdentifiable(patch: LegRatePatch): void {
  const from = patch.fromStep.trim();
  const to = patch.toStep.trim();
  if (from === '' || to === '') {
    throw new LegRateInvalidError('A leg is identified by the two steps it connects, so neither step may be empty.');
  }
  if (from === to) {
    throw new LegRateInvalidError(`A leg connects two DIFFERENT steps: "${from}" points at itself.`);
  }
}

async function readStored(orgId: string, brandId: string): Promise<StoredLegRate[]> {
  return db
    .select({
      fromStep: brandLegRates.fromStep,
      toStep: brandLegRates.toStep,
      ratePct: brandLegRates.ratePct,
      updatedAt: brandLegRates.updatedAt,
    })
    .from(brandLegRates)
    .where(and(eq(brandLegRates.orgId, orgId), eq(brandLegRates.brandId, brandId)));
}

/** Every leg, stated or not. No org claims the brand → every leg unstated. */
export async function readLegRates(orgId: string | null, brandId: string): Promise<LegRateView[]> {
  return buildLegRatesView(orgId ? await readStored(orgId, brandId) : []);
}

/** Refuse an unnamable leg or the same leg twice; return trimmed patches. */
export function normalizeLegPatches(patches: LegRatePatch[]): LegRatePatch[] {
  const seen = new Set<string>();
  return patches.map((patch) => {
    assertLegIdentifiable(patch);
    const fromStep = patch.fromStep.trim();
    const toStep = patch.toStep.trim();
    const id = legIdentity(fromStep, toStep);
    if (seen.has(id)) {
      throw new LegRateInvalidError(
        `The leg "${fromStep}" -> "${toStep}" is stated twice in one write; state it once.`
      );
    }
    seen.add(id);
    return { fromStep, toStep, ratePct: patch.ratePct };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Apply already-normalized patches inside a transaction. `null` deletes the row. */
export async function applyLegPatches(
  tx: Tx,
  orgId: string,
  brandId: string,
  patches: LegRatePatch[],
  now: string
): Promise<void> {
  for (const patch of patches) {
    const scope = and(
      eq(brandLegRates.orgId, orgId),
      eq(brandLegRates.brandId, brandId),
      eq(brandLegRates.fromStep, patch.fromStep),
      eq(brandLegRates.toStep, patch.toStep)
    );
    if (patch.ratePct === null) {
      await tx.delete(brandLegRates).where(scope);
      continue;
    }
    await tx
      .insert(brandLegRates)
      .values({ orgId, brandId, fromStep: patch.fromStep, toStep: patch.toStep, ratePct: patch.ratePct, updatedAt: now })
      .onConflictDoUpdate({
        target: [brandLegRates.orgId, brandLegRates.brandId, brandLegRates.fromStep, brandLegRates.toStep],
        set: { ratePct: patch.ratePct, carriedOverAt: null, updatedAt: now },
      });
  }
}

/**
 * State these legs. PARTIAL: a leg the patch omits is untouched; `ratePct: null`
 * deletes the statement. One transaction: a refused leg leaves nothing written.
 */
export async function writeLegRates(
  orgId: string,
  brandId: string,
  patches: LegRatePatch[]
): Promise<LegRateView[]> {
  const normalized = normalizeLegPatches(patches);
  const now = new Date().toISOString();
  await db.transaction(async (tx) => applyLegPatches(tx, orgId, brandId, normalized, now));
  return readLegRates(orgId, brandId);
}

// ---------------------------------------------------------------------------
// Per-offer lifetime revenue
// ---------------------------------------------------------------------------

export interface OfferLifetimeRevenueView {
  offerId: string;
  name: string;
  /** What a paying client of this offer is worth, USD. `null` = never stated. */
  lifetimeRevenueUsd: number | null;
  lifetimeRevenueStatedAt: string | null;
}

type OfferRow = typeof brandOffers.$inferSelect;

function formatOfferLtr(row: OfferRow): OfferLifetimeRevenueView {
  return {
    offerId: row.id,
    name: row.name,
    lifetimeRevenueUsd: row.lifetimeRevenueUsd ?? null,
    lifetimeRevenueStatedAt: row.lifetimeRevenueUsd === null ? null : row.lifetimeRevenueStatedAt ?? null,
  };
}

async function readOfferRow(orgId: string, brandId: string, offerId: string): Promise<OfferRow> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const [row] = await db
    .select()
    .from(brandOffers)
    .where(and(eq(brandOffers.id, offerId), eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)));
  return row;
}

/** Every offer of the (org, brand), oldest first, with its lifetime revenue. */
export async function readOffersLifetimeRevenue(orgId: string | null, brandId: string): Promise<OfferLifetimeRevenueView[]> {
  if (!orgId) return [];
  const rows = await db
    .select()
    .from(brandOffers)
    .where(and(eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)))
    .orderBy(asc(brandOffers.createdAt), asc(brandOffers.id));
  return rows.map(formatOfferLtr);
}

export interface OfferEconomicsView {
  offerId: string;
  name: string;
  lifetimeRevenueUsd: number | null;
  lifetimeRevenueStatedAt: string | null;
  /** The brand's leg rates — the same for every offer of the brand. */
  legRates: LegRateView[];
}

export async function readOfferEconomics(orgId: string, brandId: string, offerId: string): Promise<OfferEconomicsView> {
  const row = await readOfferRow(orgId, brandId, offerId);
  return { ...formatOfferLtr(row), legRates: await readLegRates(orgId, brandId) };
}

export interface OfferEconomicsPatch {
  lifetimeRevenueUsd?: number | null;
  legRates?: LegRatePatch[];
}

/**
 * State an offer's lifetime revenue and/or the brand's leg rates, in one
 * transaction. An omitted field is untouched; `lifetimeRevenueUsd: null` clears.
 */
export async function writeOfferEconomics(
  orgId: string,
  brandId: string,
  offerId: string,
  patch: OfferEconomicsPatch
): Promise<OfferEconomicsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const legs = patch.legRates ? normalizeLegPatches(patch.legRates) : [];
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (patch.lifetimeRevenueUsd !== undefined) {
      await setOfferLifetimeRevenue(tx, orgId, brandId, offerId, patch.lifetimeRevenueUsd, now);
    }
    if (legs.length > 0) await applyLegPatches(tx, orgId, brandId, legs, now);
  });
  return readOfferEconomics(orgId, brandId, offerId);
}

/** Set the offer's lifetime revenue. `null` clears it. */
async function setOfferLifetimeRevenue(
  tx: Tx | typeof db,
  orgId: string,
  brandId: string,
  offerId: string,
  lifetimeRevenueUsd: number | null,
  now: string
): Promise<void> {
  await tx
    .update(brandOffers)
    .set({
      lifetimeRevenueUsd,
      lifetimeRevenueStatedAt: lifetimeRevenueUsd === null ? null : now,
      lifetimeRevenueCarriedOverAt: null,
    })
    .where(and(eq(brandOffers.id, offerId), eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)));
}
