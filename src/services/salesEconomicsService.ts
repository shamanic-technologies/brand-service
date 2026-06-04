import { eq, sql } from 'drizzle-orm';
import { db, brandSalesEconomics } from '../db';

/** Brand-level B2C vs B2B classification. */
export type BusinessModel = 'b2c' | 'b2b';

/**
 * Brand-level sales conversion economics. Brand-level config reused across
 * every sales-cold-email campaign. Wire field names are consumed byte-stable
 * by api-service + the dashboard.
 *
 * `businessModel` is optional on write: omitted (`undefined`) = leave the
 * stored value unchanged; `null` = clear it. The 5 metrics stay required.
 */
export interface SalesEconomicsMetrics {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  visitToClosePct: number;
  businessModel?: BusinessModel | null;
}

export interface SavedSalesEconomics extends SalesEconomicsMetrics {
  // Always present on read; `null` = never set.
  businessModel: BusinessModel | null;
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
    updatedAt: row.updatedAt,
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
        },
      })
      .returning();

    return formatSalesEconomics(result[0]);
  }
}

export const salesEconomicsService = new SalesEconomicsService();
