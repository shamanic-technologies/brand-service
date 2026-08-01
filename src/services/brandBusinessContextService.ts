/**
 * Brand business-context store.
 *
 * The free-form text a user pastes when their brand has NO website. It is the
 * ALTERNATIVE field-extraction SOURCE to a scraped site: `fieldExtractionService`
 * reads it (via `getBrandBusinessContext`) when a brand has no `url` and runs the
 * same LLM extraction against it instead of scraping. Durable (no TTL) —
 * user-authored input, not the ephemeral extract cache. Per-brand config, one row
 * per brand.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db, brandBusinessContext } from '../db';

/**
 * Return the pasted business context for a brand, or `null` when none is stored.
 */
export async function getBrandBusinessContext(
  orgId: string,
  brandId: string): Promise<string | null> {
  const [row] = await db
    .select({ content: brandBusinessContext.content })
    .from(brandBusinessContext)
    .where(and(eq(brandBusinessContext.orgId, orgId), eq(brandBusinessContext.brandId, brandId)))
    .limit(1);
  return row?.content ?? null;
}

/**
 * Insert or replace a brand's pasted business context. Idempotent on brand_id.
 */
export async function upsertBrandBusinessContext(
  orgId: string,
  brandId: string,
  content: string,
): Promise<void> {
  await db
    .insert(brandBusinessContext)
    .values({ orgId, brandId, content })
    .onConflictDoUpdate({
      target: [brandBusinessContext.orgId, brandBusinessContext.brandId],
      set: { content, updatedAt: sql`NOW()` },
    });
}
