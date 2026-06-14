import { eq, sql } from 'drizzle-orm';
import { db, brandSalesEconomics } from '../db';

/** Brand-level B2C vs B2B classification. */
export type BusinessModel = 'b2c' | 'b2b';

/** Sales-funnel stage a brand has (multi-select, 0..3). */
export type FunnelStage = 'website_signup' | 'website_purchase' | 'sales_meeting';

/** Single brand-level optimization goal. Server default 'sales'. */
export type OptimizationGoal = 'signups' | 'booked_meetings' | 'sales';

/**
 * Brand-level sales conversion economics. Brand-level config reused across
 * every sales-cold-email campaign. Wire field names are consumed byte-stable
 * by api-service + the dashboard.
 *
 * `businessModel` is optional on write: omitted (`undefined`) = leave the
 * stored value unchanged; `null` = clear it. The 5 metrics stay required.
 *
 * `funnelStages` / `optimizationGoal` are optional on write: omitted
 * (`undefined`) = leave unchanged; sending sets. Neither is nullable — there is
 * no "clear to null" (funnelStages clears via `[]`, optimizationGoal via a value).
 */
export interface SalesEconomicsMetrics {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  visitToClosePct: number;
  businessModel?: BusinessModel | null;
  funnelStages?: FunnelStage[];
  optimizationGoal?: OptimizationGoal;
}

export interface SavedSalesEconomics extends SalesEconomicsMetrics {
  // Always present on read; `null` = never set.
  businessModel: BusinessModel | null;
  // Always an array on read; `[]` = never set.
  funnelStages: FunnelStage[];
  // Always present on read; `'sales'` = never set.
  optimizationGoal: OptimizationGoal;
  updatedAt: string;
}

function formatSalesEconomics(
  row: typeof brandSalesEconomics.$inferSelect
): SavedSalesEconomics {
  return {
    lifetimeRevenueUsd: row.lifetimeRevenueUsd,
    replyToMeetingPct: row.replyToMeetingPct,
    visitToMeetingPct: row.visitToMeetingPct,
    meetingToClosePct: row.meetingToClosePct,
    visitToClosePct: row.visitToClosePct,
    businessModel: row.businessModel as BusinessModel | null,
    funnelStages: (row.funnelStages ?? []) as FunnelStage[],
    optimizationGoal: row.optimizationGoal as OptimizationGoal,
    updatedAt: row.updatedAt,
  };
}

/** Cross-brand average of the 5 metrics — seed defaults for an unset brand. */
export interface SalesEconomicsAverages {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  visitToClosePct: number;
}

/** Provenance of the effective economics returned by the gold serving layer. */
export type EffectiveEconomicsSource = 'user' | 'cross-brand-average';

/**
 * Effective economics for a brand: the brand's saved set, or the cross-brand
 * average when unset, with the provenance. `economics`/`source` are both null
 * only at cold start (no brand has saved anything yet).
 */
export interface EffectiveSalesEconomics {
  economics: SalesEconomicsAverages | null;
  source: EffectiveEconomicsSource | null;
}

/** Raw aggregate row: every field is null when the table has zero rows. */
interface SalesEconomicsAverageRow {
  lifetimeRevenueUsd: number | null;
  replyToMeetingPct: number | null;
  visitToMeetingPct: number | null;
  meetingToClosePct: number | null;
  visitToClosePct: number | null;
}

/**
 * Pure mapper from the SQL aggregate row to the public averages shape.
 * Exported for unit testing the empty-table branch without a DB.
 * Empty table → every AVG/PERCENTILE is NULL → return null. A non-null first
 * field implies all are non-null (same WHERE-less aggregate over the same rows).
 */
export function mapAverageRow(
  row: SalesEconomicsAverageRow
): SalesEconomicsAverages | null {
  if (row.lifetimeRevenueUsd === null) return null;
  return {
    lifetimeRevenueUsd: row.lifetimeRevenueUsd,
    replyToMeetingPct: row.replyToMeetingPct!,
    visitToMeetingPct: row.visitToMeetingPct!,
    meetingToClosePct: row.meetingToClosePct!,
    visitToClosePct: row.visitToClosePct!,
  };
}

export class SalesEconomicsService {
  /**
   * Read the saved metric set for a brand, or null when nothing is saved.
   * Unset is a clean null — the caller falls back to its own defaults.
   */
  async getByBrandId(brandId: string): Promise<SavedSalesEconomics | null> {
    const result = await db
      .select()
      .from(brandSalesEconomics)
      .where(eq(brandSalesEconomics.brandId, brandId))
      .limit(1);

    if (result.length === 0) return null;
    return formatSalesEconomics(result[0]);
  }

  /**
   * Cross-brand defaults to seed a brand that has saved nothing.
   * GLOBAL — no org/brand WHERE filter: averages over EVERY saved row in the
   * table (per product decision). `lifetimeRevenueUsd` uses the MEDIAN (LTV is
   * heavy-tailed — one outlier brand skews the mean); the 4 conversion percents
   * use the MEAN (bounded 0-100, no heavy tail). All 5 returned values are
   * integers. Empty table → null (nothing to average).
   *
   * Does NOT touch getByBrandId — the per-brand read still returns null for an
   * unset brand, so features-service's null-pipeline contract stays intact.
   */
  async getAverageAcrossBrands(): Promise<SalesEconomicsAverages | null> {
    const [row] = await db
      .select({
        lifetimeRevenueUsd: sql<number | null>`ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${brandSalesEconomics.lifetimeRevenueUsd}))::int`,
        replyToMeetingPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.replyToMeetingPct}))::int`,
        visitToMeetingPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToMeetingPct}))::int`,
        meetingToClosePct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.meetingToClosePct}))::int`,
        visitToClosePct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToClosePct}))::int`,
      })
      .from(brandSalesEconomics);

    // A WHERE-less aggregate always returns exactly one row (all-null on empty).
    return mapAverageRow(row);
  }

  /**
   * Gold serving layer: the economics to USE for a brand.
   * Saved set → source "user". Unset but other brands saved → cross-brand
   * average, source "cross-brand-average". Nothing saved anywhere → both null.
   * Centralizes the null→average defaulting so consumers don't reimplement it.
   */
  async getEffectiveByBrandId(brandId: string): Promise<EffectiveSalesEconomics> {
    const saved = await this.getByBrandId(brandId);
    if (saved) {
      return {
        economics: {
          lifetimeRevenueUsd: saved.lifetimeRevenueUsd,
          replyToMeetingPct: saved.replyToMeetingPct,
          visitToMeetingPct: saved.visitToMeetingPct,
          meetingToClosePct: saved.meetingToClosePct,
          visitToClosePct: saved.visitToClosePct,
        },
        source: 'user',
      };
    }

    const average = await this.getAverageAcrossBrands();
    if (average) {
      return { economics: average, source: 'cross-brand-average' };
    }

    // Cold start — no brand has saved economics yet.
    return { economics: null, source: null };
  }

  /**
   * Idempotent upsert of the full 5-metric set. Single row per brand
   * (PK = brand_id). Repeating the same write yields the same end state.
   */
  async upsertByBrandId(
    brandId: string,
    metrics: SalesEconomicsMetrics
  ): Promise<SavedSalesEconomics> {
    const result = await db
      .insert(brandSalesEconomics)
      .values({
        brandId,
        lifetimeRevenueUsd: metrics.lifetimeRevenueUsd,
        replyToMeetingPct: metrics.replyToMeetingPct,
        visitToMeetingPct: metrics.visitToMeetingPct,
        meetingToClosePct: metrics.meetingToClosePct,
        visitToClosePct: metrics.visitToClosePct,
        // Fresh row: undefined (omitted) stores as null (never set).
        businessModel: metrics.businessModel ?? null,
        // Fresh row: omitted funnelStages/optimizationGoal fall back to the
        // column defaults ([] / 'sales') — a never-set brand reads those.
        funnelStages: metrics.funnelStages ?? [],
        optimizationGoal: metrics.optimizationGoal ?? 'sales',
      })
      .onConflictDoUpdate({
        target: brandSalesEconomics.brandId,
        set: {
          lifetimeRevenueUsd: metrics.lifetimeRevenueUsd,
          replyToMeetingPct: metrics.replyToMeetingPct,
          visitToMeetingPct: metrics.visitToMeetingPct,
          meetingToClosePct: metrics.meetingToClosePct,
          visitToClosePct: metrics.visitToClosePct,
          updatedAt: sql`NOW()`,
          // Only touch business_model when the caller supplied it (including an
          // explicit null to clear). Omitted = preserve the stored value, so the
          // legacy 5-field PUT never wipes a separately-set business model.
          ...(metrics.businessModel !== undefined
            ? { businessModel: metrics.businessModel }
            : {}),
          // Only touch funnel_stages when supplied (including `[]` to clear).
          // Omitted = preserve the stored value.
          ...(metrics.funnelStages !== undefined
            ? { funnelStages: metrics.funnelStages }
            : {}),
          // Only touch optimization_goal when supplied. Omitted = preserve.
          ...(metrics.optimizationGoal !== undefined
            ? { optimizationGoal: metrics.optimizationGoal }
            : {}),
        },
      })
      .returning();

    return formatSalesEconomics(result[0]);
  }
}

export const salesEconomicsService = new SalesEconomicsService();
