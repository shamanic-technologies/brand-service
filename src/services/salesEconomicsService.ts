import { eq, sql } from 'drizzle-orm';
import { db, brandSalesEconomics } from '../db';

/**
 * The 5 sales conversion-economics metrics for a brand. Brand-level config
 * reused across every sales-cold-email campaign. Wire field names are
 * consumed byte-stable by api-service + the dashboard.
 */
export interface SalesEconomicsMetrics {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  visitToClosePct: number;
}

export interface SavedSalesEconomics extends SalesEconomicsMetrics {
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
        },
      })
      .returning();

    return formatSalesEconomics(result[0]);
  }
}

export const salesEconomicsService = new SalesEconomicsService();
