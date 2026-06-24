import { eq, sql } from 'drizzle-orm';
import { db, brandClickDestination } from '../db';

/**
 * Brand-level click-destination URL. One row per brand (PK = brand_id),
 * reused across that brand's outreach campaigns. The URL is validated +
 * normalized at the route boundary (BrandUrlSchema) before it reaches here.
 */
export const clickDestinationService = {
  /**
   * Idempotent upsert of a brand's click-destination URL. Returns the saved
   * (already-normalized) value.
   */
  async upsertByBrandId(brandId: string, clickDestinationUrl: string): Promise<string> {
    const [row] = await db
      .insert(brandClickDestination)
      .values({ brandId, clickDestinationUrl })
      .onConflictDoUpdate({
        target: brandClickDestination.brandId,
        set: { clickDestinationUrl, updatedAt: sql`NOW()` },
      })
      .returning({ clickDestinationUrl: brandClickDestination.clickDestinationUrl });

    return row.clickDestinationUrl;
  },

  /**
   * Read a brand's saved click-destination URL, or null when unset (no row).
   */
  async getByBrandId(brandId: string): Promise<string | null> {
    const [row] = await db
      .select({ clickDestinationUrl: brandClickDestination.clickDestinationUrl })
      .from(brandClickDestination)
      .where(eq(brandClickDestination.brandId, brandId))
      .limit(1);

    return row?.clickDestinationUrl ?? null;
  },
};
