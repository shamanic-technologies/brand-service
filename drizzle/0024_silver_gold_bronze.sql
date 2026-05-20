-- Silver/Gold/Bronze data layering for brand-service.
--
-- Rename old tables with `_old` suffix (preserves data — NO DELETE). All
-- application code switches to the new silver tables. _old tables remain as
-- a safety net until a follow-up PR drops them.
--
-- Silver:
--   - brands              (global, no org_id, unique by normalized domain)
--   - brand_extracted_fields (with field_description hash in key)
-- Gold:
--   - org_brands          (org_id ↔ brand_id N:N membership)
-- Bronze:
--   - scrape_raw          (append-only raw scrape payloads)
-- Helper:
--   - brand_id_remap      (old brand_id → canonical new brand_id, for child-table FK rewiring)

-- ── Rename old tables ──────────────────────────────────────────────

ALTER TABLE "brands" RENAME TO "brands_old";
--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" RENAME TO "brand_extracted_fields_old";
--> statement-breakpoint

-- Rename existing indexes on _old tables so that the original index names are
-- free for the new silver tables. Index renames are best-effort; missing
-- indexes are skipped via DO blocks.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_extracted_fields_brand_key_desc_no_campaign') THEN
    EXECUTE 'ALTER INDEX "idx_extracted_fields_brand_key_desc_no_campaign" RENAME TO "idx_extracted_fields_brand_key_desc_no_campaign_old"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_extracted_fields_brand_key_desc_campaign') THEN
    EXECUTE 'ALTER INDEX "idx_extracted_fields_brand_key_desc_campaign" RENAME TO "idx_extracted_fields_brand_key_desc_campaign_old"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_extracted_fields_expires') THEN
    EXECUTE 'ALTER INDEX "idx_extracted_fields_expires" RENAME TO "idx_extracted_fields_expires_old"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_extracted_fields_campaign') THEN
    EXECUTE 'ALTER INDEX "idx_extracted_fields_campaign" RENAME TO "idx_extracted_fields_campaign_old"';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'brands_domain_key') THEN
    EXECUTE 'ALTER INDEX "brands_domain_key" RENAME TO "brands_domain_key_old"';
  END IF;
END $$;
--> statement-breakpoint
-- page_scrape_cache, url_map_cache, scraped_url_firecrawl are operational
-- TTL caches, NOT business data. They are out of scope for the silver/gold
-- layering and remain unchanged. A follow-up PR can migrate them onto the
-- new `scrape_raw` bronze table.
--> statement-breakpoint

-- ── Silver: brands (global, no org_id) ─────────────────────────────

CREATE TABLE IF NOT EXISTS "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "domain" text NOT NULL,
  "url" text NOT NULL,
  "name" text,
  "logo_url" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brands_domain_key" ON "brands" ("domain");
--> statement-breakpoint

-- ── Backfill silver brands deduped by normalized domain ────────────
-- Domain normalization mirrors src/lib/url-utils.ts extractDomain:
--   lowercase, strip leading "www.". Picks the most-recently-updated row per
--   normalized domain as the canonical brand.

INSERT INTO "brands" ("id", "domain", "url", "name", "logo_url", "created_at", "updated_at")
SELECT DISTINCT ON (lower(regexp_replace(b."domain", '^www\.', '')))
  b."id",
  lower(regexp_replace(b."domain", '^www\.', '')),
  b."url",
  b."name",
  b."logo_url",
  b."created_at",
  b."updated_at"
FROM "brands_old" b
WHERE b."domain" IS NOT NULL AND b."url" IS NOT NULL
ORDER BY
  lower(regexp_replace(b."domain", '^www\.', '')),
  b."updated_at" DESC
ON CONFLICT ("domain") DO NOTHING;
--> statement-breakpoint

-- ── Helper: brand_id_remap (old brand_id → canonical new brand_id) ─

CREATE TABLE IF NOT EXISTS "brand_id_remap" (
  "old_brand_id" uuid PRIMARY KEY,
  "new_brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE
);
--> statement-breakpoint

INSERT INTO "brand_id_remap" ("old_brand_id", "new_brand_id")
SELECT bo."id", b."id"
FROM "brands_old" bo
JOIN "brands" b ON b."domain" = lower(regexp_replace(bo."domain", '^www\.', ''))
WHERE bo."domain" IS NOT NULL
ON CONFLICT ("old_brand_id") DO NOTHING;
--> statement-breakpoint

-- ── Gold: org_brands (org_id ↔ brand_id N:N) ──────────────────────

CREATE TABLE IF NOT EXISTS "org_brands" (
  "org_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  "claimed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("org_id", "brand_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_brands_brand_id_idx" ON "org_brands" ("brand_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_brands_org_id_idx" ON "org_brands" ("org_id");
--> statement-breakpoint
ALTER TABLE "org_brands"
  DROP CONSTRAINT IF EXISTS "org_brands_brand_id_fkey";
--> statement-breakpoint
ALTER TABLE "org_brands"
  ADD CONSTRAINT "org_brands_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

INSERT INTO "org_brands" ("org_id", "brand_id", "claimed_at", "updated_at")
SELECT DISTINCT bo."org_id", r."new_brand_id", bo."created_at", bo."updated_at"
FROM "brands_old" bo
JOIN "brand_id_remap" r ON r."old_brand_id" = bo."id"
WHERE bo."org_id" IS NOT NULL
ON CONFLICT ("org_id", "brand_id") DO NOTHING;
--> statement-breakpoint

-- ── Silver: brand_extracted_fields (with field_description hash in key) ──

CREATE TABLE IF NOT EXISTS "brand_extracted_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "field_key" text NOT NULL,
  "field_description" text NOT NULL DEFAULT '',
  "field_description_hash" text NOT NULL DEFAULT md5(''),
  "field_value" jsonb,
  "source_urls" jsonb,
  "campaign_id" uuid,
  "extracted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "brand_extracted_fields"
  DROP CONSTRAINT IF EXISTS "brand_extracted_fields_brand_id_fkey";
--> statement-breakpoint
ALTER TABLE "brand_extracted_fields"
  ADD CONSTRAINT "brand_extracted_fields_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extracted_fields_expires"
  ON "brand_extracted_fields" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extracted_fields_campaign"
  ON "brand_extracted_fields" ("campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_extracted_fields_brand_key_desc_no_campaign"
  ON "brand_extracted_fields" ("brand_id", "field_key", "field_description_hash")
  WHERE "campaign_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_extracted_fields_brand_key_desc_campaign"
  ON "brand_extracted_fields" ("brand_id", "field_key", "field_description_hash", "campaign_id")
  WHERE "campaign_id" IS NOT NULL;
--> statement-breakpoint

-- Backfill brand_extracted_fields silver from _old via brand_id_remap.
-- Drops rows that collide on the new unique key (last-write-wins by extracted_at).

INSERT INTO "brand_extracted_fields"
  ("id", "brand_id", "field_key", "field_description", "field_description_hash",
   "field_value", "source_urls", "campaign_id",
   "extracted_at", "expires_at", "created_at", "updated_at")
SELECT
  bef."id",
  r."new_brand_id",
  bef."field_key",
  bef."field_description",
  bef."field_description_hash",
  bef."field_value",
  bef."source_urls",
  bef."campaign_id",
  bef."extracted_at",
  bef."expires_at",
  bef."created_at",
  bef."updated_at"
FROM "brand_extracted_fields_old" bef
JOIN "brand_id_remap" r ON r."old_brand_id" = bef."brand_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── Bronze: scrape_raw (append-only) ──────────────────────────────

CREATE TABLE IF NOT EXISTS "scrape_raw" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "normalized_url" text NOT NULL,
  "source" text NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scrape_raw_normalized_url_fetched_at_key"
  ON "scrape_raw" ("normalized_url", "fetched_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scrape_raw_normalized_url_idx"
  ON "scrape_raw" ("normalized_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scrape_raw_fetched_at_idx"
  ON "scrape_raw" ("fetched_at" DESC);
--> statement-breakpoint

-- ── Rewire child-table FKs from brands_old → new brands via remap ─

-- media_assets.brand_id
ALTER TABLE "media_assets"
  DROP CONSTRAINT IF EXISTS "media_assets_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "media_assets"
  DROP CONSTRAINT IF EXISTS "media_assets_brand_id_fkey";
--> statement-breakpoint
UPDATE "media_assets" m
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE m."brand_id" = r."old_brand_id" AND m."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_linkedin_posts.brand_id
ALTER TABLE "brand_linkedin_posts"
  DROP CONSTRAINT IF EXISTS "organizations_linkedin_posts_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "brand_linkedin_posts"
  DROP CONSTRAINT IF EXISTS "brand_linkedin_posts_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_linkedin_posts" t
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."brand_id" = r."old_brand_id" AND t."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_linkedin_posts"
  ADD CONSTRAINT "brand_linkedin_posts_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_individuals.brand_id
ALTER TABLE "brand_individuals"
  DROP CONSTRAINT IF EXISTS "brand_individuals_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_individuals" t
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."brand_id" = r."old_brand_id" AND t."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_individuals"
  ADD CONSTRAINT "brand_individuals_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_relations.source_brand_id + target_brand_id
ALTER TABLE "brand_relations"
  DROP CONSTRAINT IF EXISTS "brand_relations_source_brand_id_fkey";
--> statement-breakpoint
ALTER TABLE "brand_relations"
  DROP CONSTRAINT IF EXISTS "brand_relations_target_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_relations" t
SET "source_brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."source_brand_id" = r."old_brand_id" AND t."source_brand_id" <> r."new_brand_id";
--> statement-breakpoint
UPDATE "brand_relations" t
SET "target_brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."target_brand_id" = r."old_brand_id" AND t."target_brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_relations"
  ADD CONSTRAINT "brand_relations_source_brand_id_fkey"
  FOREIGN KEY ("source_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "brand_relations"
  ADD CONSTRAINT "brand_relations_target_brand_id_fkey"
  FOREIGN KEY ("target_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_thesis.brand_id (FK may not exist on all branches; safe drop+add)
ALTER TABLE "brand_thesis"
  DROP CONSTRAINT IF EXISTS "brand_thesis_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_thesis" t
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."brand_id" = r."old_brand_id" AND t."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_thesis"
  ADD CONSTRAINT "brand_thesis_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_extracted_images.brand_id
ALTER TABLE "brand_extracted_images"
  DROP CONSTRAINT IF EXISTS "brand_extracted_images_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_extracted_images" t
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."brand_id" = r."old_brand_id" AND t."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_extracted_images"
  ADD CONSTRAINT "brand_extracted_images_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- intake_forms.brand_id (may have unique(brand_id))
ALTER TABLE "intake_forms"
  DROP CONSTRAINT IF EXISTS "intake_forms_brand_id_fkey";
--> statement-breakpoint
-- Dedupe intake_forms colliding on remapped (brand_id) — keep most recent.
DELETE FROM "intake_forms" a
USING "intake_forms" b, "brand_id_remap" ra, "brand_id_remap" rb
WHERE ra."old_brand_id" = a."brand_id"
  AND rb."old_brand_id" = b."brand_id"
  AND ra."new_brand_id" = rb."new_brand_id"
  AND a."id" <> b."id"
  AND a."updated_at" < b."updated_at";
--> statement-breakpoint
UPDATE "intake_forms" t
SET "brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."brand_id" = r."old_brand_id" AND t."brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "intake_forms"
  ADD CONSTRAINT "intake_forms_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- brand_transfers.source_brand_id + target_brand_id (FK names vary by branch)
ALTER TABLE "brand_transfers"
  DROP CONSTRAINT IF EXISTS "brand_transfers_source_brand_id_fkey";
--> statement-breakpoint
ALTER TABLE "brand_transfers"
  DROP CONSTRAINT IF EXISTS "brand_transfers_target_brand_id_fkey";
--> statement-breakpoint
UPDATE "brand_transfers" t
SET "source_brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."source_brand_id" = r."old_brand_id" AND t."source_brand_id" <> r."new_brand_id";
--> statement-breakpoint
UPDATE "brand_transfers" t
SET "target_brand_id" = r."new_brand_id"
FROM "brand_id_remap" r
WHERE t."target_brand_id" IS NOT NULL
  AND t."target_brand_id" = r."old_brand_id"
  AND t."target_brand_id" <> r."new_brand_id";
--> statement-breakpoint
ALTER TABLE "brand_transfers"
  ADD CONSTRAINT "brand_transfers_source_brand_id_fkey"
  FOREIGN KEY ("source_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "brand_transfers"
  ADD CONSTRAINT "brand_transfers_target_brand_id_fkey"
  FOREIGN KEY ("target_brand_id") REFERENCES "brands"("id") ON DELETE SET NULL;
