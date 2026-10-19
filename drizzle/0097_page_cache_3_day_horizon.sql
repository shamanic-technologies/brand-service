-- PAGE COPIES NEVER OUTLIVE THE FACTS THEY FEED (BRAND-PAGE-CACHE-STALE-1019).
-- Saved pages and site page lists were kept 180 days; brand facts are rebuilt
-- every 3 days from them, so a 3-day re-extraction re-read a months-old copy
-- (Distribute.you emails quoted "$1/day" and "$30 free, no credit card" from a
-- homepage saved 2026-09-29). New copies now expire after 3 days
-- (src/lib/page-cache-ttl.ts); this brings every existing row in line. Rows
-- older than 3 days become expired, so the next reader fetches the page again.
-- Data-only, nothing deleted, idempotent.
UPDATE "page_scrape_cache" SET "expires_at" = "scraped_at" + interval '3 days', "updated_at" = NOW() WHERE "expires_at" > "scraped_at" + interval '3 days';--> statement-breakpoint
UPDATE "url_map_cache" SET "expires_at" = "mapped_at" + interval '3 days', "updated_at" = NOW() WHERE "expires_at" > "mapped_at" + interval '3 days';
