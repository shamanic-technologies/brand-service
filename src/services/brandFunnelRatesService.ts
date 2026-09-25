import { and, eq, isNotNull, sql } from 'drizzle-orm';
import {
  db,
  brandFunnelArrowRates,
  brandSalesFunnels,
  brandSalesFunnelArrowRates,
} from '../db';
import {
  BrandRatesMigrationPlan,
  OfferArrowSource,
  OfferFunnelSource,
  StoredBrandArrowRate,
  buildBrandFunnelRatesView,
  buildFunnelRatesView,
  planBrandRatesMigration,
} from '../lib/brand-funnel-rates';
import {
  SALES_FUNNEL_RATE_KEYS,
  SalesFunnelKey,
  SalesFunnelRateKey,
  isSalesFunnelKey,
} from './salesFunnelCatalogue';
import {
  SalesFunnelArrowInvalidError,
  SalesFunnelArrowRatePatch,
  assertArrowIdentifiable,
} from './salesFunnelArrowRatesService';

/**
 * The conversion rates a BRAND states for the arrows of its sales funnels — one
 * set per (org, brand, funnel, arrow), shared by every offer of the brand.
 *
 * Deliberately independent of the per-offer rates: nothing here reads or writes
 * `brand_sales_funnels` / `brand_sales_funnel_arrow_rates` except the one-time
 * migration at the bottom, which only READS them.
 */

async function readStored(
  orgId: string,
  brandId: string,
  funnelKey?: SalesFunnelKey
): Promise<StoredBrandArrowRate[]> {
  const where = [
    eq(brandFunnelArrowRates.orgId, orgId),
    eq(brandFunnelArrowRates.brandId, brandId),
  ];
  if (funnelKey) where.push(eq(brandFunnelArrowRates.funnelKey, funnelKey));
  return db
    .select({
      funnelKey: brandFunnelArrowRates.funnelKey,
      fromStep: brandFunnelArrowRates.fromStep,
      toStep: brandFunnelArrowRates.toStep,
      ratePct: brandFunnelArrowRates.ratePct,
      updatedAt: brandFunnelArrowRates.updatedAt,
    })
    .from(brandFunnelArrowRates)
    .where(and(...where));
}

/** Every funnel of the catalogue (or just one), each arrow stated or not. */
export async function readBrandFunnelRates(
  orgId: string | null,
  brandId: string,
  funnelKey?: SalesFunnelKey
) {
  // No org claims the brand: nothing is configured, so every arrow is unstated.
  const stored = orgId ? await readStored(orgId, brandId, funnelKey) : [];
  return buildBrandFunnelRatesView(stored, funnelKey);
}

/**
 * Write what the caller stated for these arrows of one funnel. PARTIAL: an arrow
 * the patch omits is untouched; `ratePct: null` DELETES the statement, which
 * keeps "not stated" one state. Restating a migrated rate clears its migration
 * provenance — the number is the caller's now. One transaction: a refused arrow
 * leaves nothing written.
 */
export async function writeBrandFunnelRates(
  orgId: string,
  brandId: string,
  funnelKey: SalesFunnelKey,
  patches: SalesFunnelArrowRatePatch[]
) {
  const seen = new Set<string>();
  const normalized = patches.map((patch) => {
    assertArrowIdentifiable(patch);
    const fromStep = patch.fromStep.trim();
    const toStep = patch.toStep.trim();
    const id = `${fromStep}\u0000${toStep}`;
    if (seen.has(id)) {
      throw new SalesFunnelArrowInvalidError(
        `The arrow "${fromStep}" -> "${toStep}" is stated twice in one write; state it once.`
      );
    }
    seen.add(id);
    return { fromStep, toStep, ratePct: patch.ratePct };
  });

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const patch of normalized) {
      const scope = and(
        eq(brandFunnelArrowRates.orgId, orgId),
        eq(brandFunnelArrowRates.brandId, brandId),
        eq(brandFunnelArrowRates.funnelKey, funnelKey),
        eq(brandFunnelArrowRates.fromStep, patch.fromStep),
        eq(brandFunnelArrowRates.toStep, patch.toStep)
      );
      if (patch.ratePct === null) {
        await tx.delete(brandFunnelArrowRates).where(scope);
        continue;
      }
      await tx
        .insert(brandFunnelArrowRates)
        .values({
          orgId,
          brandId,
          funnelKey,
          fromStep: patch.fromStep,
          toStep: patch.toStep,
          ratePct: patch.ratePct,
        })
        .onConflictDoUpdate({
          target: [
            brandFunnelArrowRates.orgId,
            brandFunnelArrowRates.brandId,
            brandFunnelArrowRates.funnelKey,
            brandFunnelArrowRates.fromStep,
            brandFunnelArrowRates.toStep,
          ],
          set: { ratePct: patch.ratePct, migratedFromOfferId: null, migratedAt: null, updatedAt: now },
        });
    }
  });

  const stored = await readStored(orgId, brandId, funnelKey);
  return buildFunnelRatesView(funnelKey, stored);
}

// ---------------------------------------------------------------------------
// The one-time move from the per-offer grain (scripts/migrate-funnel-rates-to-brand.ts)
// ---------------------------------------------------------------------------

/** Every per-offer declaration and arrow row, in the shape the plan reads. */
export async function readMigrationSources(): Promise<{
  funnels: OfferFunnelSource[];
  arrows: OfferArrowSource[];
}> {
  const funnelRows = await db
    .select()
    .from(brandSalesFunnels)
    .where(isNotNull(brandSalesFunnels.offerId));
  const arrowRows = await db.select().from(brandSalesFunnelArrowRates);

  const funnels: OfferFunnelSource[] = [];
  for (const row of funnelRows) {
    if (!isSalesFunnelKey(row.funnelKey)) {
      throw new Error(`brand_sales_funnels ${row.id} carries a non-canonical funnel key "${row.funnelKey}"`);
    }
    const namedRates: Partial<Record<SalesFunnelRateKey, number | null>> = {};
    for (const key of SALES_FUNNEL_RATE_KEYS) {
      const value = (row as Record<string, unknown>)[key];
      namedRates[key] = value === null || value === undefined ? null : Number(value);
    }
    funnels.push({
      orgId: row.orgId,
      brandId: row.brandId,
      offerId: row.offerId!,
      funnelKey: row.funnelKey,
      namedRates,
      updatedAt: row.updatedAt,
      economicsBackfilledAt: row.economicsBackfilledAt,
    });
  }

  const arrows: OfferArrowSource[] = arrowRows.map((row) => {
    if (!isSalesFunnelKey(row.funnelKey)) {
      throw new Error(`brand_sales_funnel_arrow_rates ${row.id} carries a non-canonical funnel key "${row.funnelKey}"`);
    }
    return {
      orgId: row.orgId,
      brandId: row.brandId,
      offerId: row.offerId,
      funnelKey: row.funnelKey,
      fromStep: row.fromStep,
      toStep: row.toStep,
      ratePct: Number(row.ratePct),
      updatedAt: row.updatedAt,
      backfilledAt: row.backfilledAt,
    };
  });

  return { funnels, arrows };
}

export async function planMigrationFromDatabase(): Promise<BrandRatesMigrationPlan> {
  const { funnels, arrows } = await readMigrationSources();
  return planBrandRatesMigration(funnels, arrows);
}

/**
 * Write the plan. NEVER OVERWRITES: a rate the brand already states at the brand
 * grain conflicts away untouched. Idempotent for the same reason — a re-run
 * inserts nothing. Returns the number of rows actually inserted.
 */
export async function applyMigrationPlan(plan: BrandRatesMigrationPlan): Promise<number> {
  const now = new Date().toISOString();
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const w of plan.writes) {
      const rows = await tx
        .insert(brandFunnelArrowRates)
        .values({
          orgId: w.orgId,
          brandId: w.brandId,
          funnelKey: w.funnelKey,
          fromStep: w.fromStep,
          toStep: w.toStep,
          ratePct: w.ratePct,
          migratedFromOfferId: w.offerId,
          migratedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: brandFunnelArrowRates.id });
      inserted += rows.length;
    }
  });
  return inserted;
}

/** Count of migrated rows, read from the table, never from the script's log. */
export async function countMigratedRows(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(brandFunnelArrowRates)
    .where(isNotNull(brandFunnelArrowRates.migratedAt));
  return row.n;
}
