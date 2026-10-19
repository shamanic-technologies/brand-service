/**
 * How long a saved copy of a page (`page_scrape_cache`) or of a site's page
 * list (`url_map_cache`) may live. ONE horizon for every reader and writer.
 *
 * 3 days = the refresh horizon of the brand facts built from those pages
 * (`fieldExtractionService` CACHE_DURATION_MS), the shortest-lived thing any
 * page feeds. A copy must never outlive the data it produces: before
 * 2026-10-19 pages were kept 180 days, so every 3-day re-extraction of
 * Distribute.you re-read a homepage saved on 09-29 and the emails kept
 * promising "$1/day" and "$30 free, no credit card" weeks after the site
 * dropped them. Slower consumers (competitors, LinkedIn page, images) simply
 * re-read the site when they refresh; the cache still dedupes the scrapes of
 * one burst of extractions.
 *
 * A caller's `scrapeCacheTtlDays` can shorten the horizon, never lengthen it.
 */
export const PAGE_CACHE_TTL_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const PAGE_CACHE_MAX_AGE_MS = PAGE_CACHE_TTL_DAYS * DAY_MS;

/** Clamp a requested TTL (days) to the page-cache horizon. */
export function pageCacheTtlDays(requested?: number | null): number {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) return PAGE_CACHE_TTL_DAYS;
  return Math.min(requested, PAGE_CACHE_TTL_DAYS);
}

/** Expiry timestamp for a copy written now, never past the horizon. */
export function pageCacheExpiresAt(requestedTtlDays?: number | null, now: Date = new Date()): string {
  return new Date(now.getTime() + pageCacheTtlDays(requestedTtlDays) * DAY_MS).toISOString();
}

/** Oldest `scraped_at` / `mapped_at` any reader may trust. */
export function pageCacheCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - PAGE_CACHE_MAX_AGE_MS).toISOString();
}
