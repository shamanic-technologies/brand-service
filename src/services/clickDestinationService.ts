import { eq, inArray, sql } from 'drizzle-orm';
import { db, brandClickDestinations } from '../db';

/**
 * Per-brand "click destination URL" config: the page outreach clicks should
 * land on. Default (no row) is the brand's own domain; the user can override it
 * with another page of their site. Brand-level config reused across that brand's
 * campaigns — mirrors the sales-economics per-brand-config scoping (keyed by
 * brand_id, NOT on the global `brands` identity row).
 */

/**
 * Validate that a user-supplied click destination is an absolute http(s) URL.
 * Fails loud: invalid input throws (the route maps it to 400). No silent
 * coercion / fallback — an unparseable or non-http(s) URL is rejected.
 */
export function normalizeClickDestinationUrl(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ClickDestinationValidationError('clickDestinationUrl must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new ClickDestinationValidationError('clickDestinationUrl must be a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ClickDestinationValidationError('clickDestinationUrl must use http or https');
  }
  return parsed.toString();
}

/** Thrown on invalid click-destination input — the route maps it to a 400. */
export class ClickDestinationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClickDestinationValidationError';
  }
}

export class ClickDestinationService {
  /** The saved click destination for a brand, or null when unset (no row). */
  async getByBrandId(brandId: string): Promise<string | null> {
    const [row] = await db
      .select({ clickDestinationUrl: brandClickDestinations.clickDestinationUrl })
      .from(brandClickDestinations)
      .where(eq(brandClickDestinations.brandId, brandId))
      .limit(1);

    return row?.clickDestinationUrl ?? null;
  }

  /**
   * Batch read for many brands at once. Returns a Map keyed by brandId; brands
   * with no row are absent from the map (caller treats absent as null).
   */
  async getMapByBrandIds(brandIds: string[]): Promise<Map<string, string>> {
    if (brandIds.length === 0) return new Map();
    const rows = await db
      .select({
        brandId: brandClickDestinations.brandId,
        clickDestinationUrl: brandClickDestinations.clickDestinationUrl,
      })
      .from(brandClickDestinations)
      .where(inArray(brandClickDestinations.brandId, brandIds));

    return new Map(rows.map((r) => [r.brandId, r.clickDestinationUrl]));
  }

  /**
   * Idempotent upsert of a brand's click destination. Single row per brand
   * (PK = brand_id); repeating the same write yields the same end state. The
   * URL is validated (http/https) before this is called. Returns the saved URL.
   */
  async upsertByBrandId(brandId: string, clickDestinationUrl: string): Promise<string> {
    const [row] = await db
      .insert(brandClickDestinations)
      .values({ brandId, clickDestinationUrl })
      .onConflictDoUpdate({
        target: brandClickDestinations.brandId,
        set: { clickDestinationUrl, updatedAt: sql`NOW()` },
      })
      .returning({ clickDestinationUrl: brandClickDestinations.clickDestinationUrl });

    return row.clickDestinationUrl;
  }
}

export const clickDestinationService = new ClickDestinationService();
