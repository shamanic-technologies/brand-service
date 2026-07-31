-- Close a cross-org data leak: per-brand CONFIG becomes per-(org, brand).
--
-- `brands` is the global silver identity, and several orgs legitimately claim
-- the same domain (21 brands in prod are claimed by more than one org, one by
-- ten). Every config table below was keyed on `brand_id` ALONE, so any org
-- could POST /orgs/brands with an existing domain, receive the same brand id,
-- and then read or overwrite another org's sales economics, confirmed fields,
-- click destination, WhatsApp link, share credential or goal.
--
-- Existing rows are COPIED to every org that claims the brand, not attributed to
-- one of them. Today all those orgs read the same row, so copying is the
-- faithful translation of the current state: each org keeps exactly what it
-- already saw, and nothing propagates between them afterwards. Attributing to a
-- single org would instead TAKE the configuration away from the others -- 42
-- (org, brand) pairs would lose their economics and 177 confirmed fields would
-- vanish from dashboards that show them today. Closing the leak does not
-- require deleting anyone's data.
--
-- Two exceptions, both attributed to the first claiming org rather than copied:
--   * `brand_share_tokens` -- a share credential is nominative and its token is
--     globally unique, so duplicating it would mint a second live link the user
--     never asked for. No multi-org brand has one today.
--   * `brand_sales_funnels` -- no rows in any environment yet.
--
-- Rows whose brand has NO org at all cannot be attributed to anyone and are
-- already unreachable (no membership => no /orgs route can serve them). They
-- are ARCHIVED verbatim into `orphaned_brand_config_archive` before deletion
-- rather than silently dropped, so nothing user-authored disappears without a
-- trace. That table can be dropped once the archive has been reviewed.
--
-- Hand-authored: drizzle-kit emits `ADD COLUMN ... NOT NULL` on populated
-- tables, adds the new primary key before the column exists, and drops
-- `brands.current_goal` without carrying it over. None of that is applicable.

-- 1. The goal moves off the shared identity row onto the (org, brand) pair. ----
ALTER TABLE "org_brands" ADD COLUMN IF NOT EXISTS "current_goal" text;--> statement-breakpoint

UPDATE "org_brands" o
   SET "current_goal" = b."current_goal"
  FROM "brands" b
 WHERE b."id" = o."brand_id"
   AND o."current_goal" IS NULL;--> statement-breakpoint

-- A membership whose brand somehow carries no goal falls back to the column
-- default that `brands.current_goal` itself had.
UPDATE "org_brands" SET "current_goal" = 'purchase' WHERE "current_goal" IS NULL;--> statement-breakpoint

ALTER TABLE "org_brands" ALTER COLUMN "current_goal" SET DEFAULT 'purchase';--> statement-breakpoint
ALTER TABLE "org_brands" ALTER COLUMN "current_goal" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "org_brands" DROP CONSTRAINT IF EXISTS "org_brands_current_goal_check";--> statement-breakpoint
ALTER TABLE "org_brands" ADD CONSTRAINT "org_brands_current_goal_check"
  CHECK ("org_brands"."current_goal" IN ('signup', 'meetingBooked', 'purchase', 'websiteVisit', 'positiveReply', 'whatsappConversation', 'combinedSales'));--> statement-breakpoint

-- 2. Archive config rows that belong to a brand no org claims. ----------------
CREATE TABLE IF NOT EXISTS "orphaned_brand_config_archive" (
	"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
	"source_table" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"row" jsonb NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_sales_economics', x."brand_id", to_jsonb(x) FROM "brand_sales_economics" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_click_destinations', x."brand_id", to_jsonb(x) FROM "brand_click_destinations" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_whatsapp_links', x."brand_id", to_jsonb(x) FROM "brand_whatsapp_links" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_business_context', x."brand_id", to_jsonb(x) FROM "brand_business_context" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_user_fields', x."brand_id", to_jsonb(x) FROM "brand_user_fields" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_share_tokens', x."brand_id", to_jsonb(x) FROM "brand_share_tokens" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint
INSERT INTO "orphaned_brand_config_archive" ("source_table", "brand_id", "row")
SELECT 'brand_sales_funnels', x."brand_id", to_jsonb(x) FROM "brand_sales_funnels" x
 WHERE NOT EXISTS (SELECT 1 FROM "org_brands" o WHERE o."brand_id" = x."brand_id");--> statement-breakpoint

-- 3. Add org_id, attribute, drop the unreachable rows, re-key. ----------------
ALTER TABLE "brand_sales_economics" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_click_destinations" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_whatsapp_links" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_business_context" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_share_tokens" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint

-- The OLD keys go first: while `brand_id` alone is still the primary key, a
-- second row for the same brand (the copy for another org) cannot be inserted.
ALTER TABLE "brand_sales_economics" DROP CONSTRAINT IF EXISTS "brand_sales_economics_pkey";--> statement-breakpoint
ALTER TABLE "brand_click_destinations" DROP CONSTRAINT IF EXISTS "brand_click_destinations_pkey";--> statement-breakpoint
ALTER TABLE "brand_whatsapp_links" DROP CONSTRAINT IF EXISTS "brand_whatsapp_links_pkey";--> statement-breakpoint
ALTER TABLE "brand_business_context" DROP CONSTRAINT IF EXISTS "brand_business_context_pkey";--> statement-breakpoint
ALTER TABLE "brand_share_tokens" DROP CONSTRAINT IF EXISTS "brand_share_tokens_pkey";--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_brand_id_funnel_key_pk";--> statement-breakpoint
DROP INDEX IF EXISTS "brand_user_fields_brand_id_field_key_key";--> statement-breakpoint

-- Every org that claims the brand gets its OWN copy of what it already reads.
-- The copies go to the claiming orgs OTHER than the first one; the original row
-- is then attributed to that first org, so no row is duplicated or lost.
-- `jsonb_populate_record` rebuilds the row generically, so this stays correct
-- whatever columns each table happens to have.
INSERT INTO "brand_sales_economics"
SELECT (jsonb_populate_record(NULL::"brand_sales_economics",
        to_jsonb(x) || jsonb_build_object('org_id', o."org_id"))).*
  FROM "brand_sales_economics" x
  JOIN "org_brands" o ON o."brand_id" = x."brand_id"
 WHERE x."org_id" IS NULL
   AND o."org_id" <> (SELECT o2."org_id" FROM "org_brands" o2 WHERE o2."brand_id" = x."brand_id"
                       ORDER BY o2."claimed_at" ASC, o2."org_id" ASC LIMIT 1);--> statement-breakpoint

INSERT INTO "brand_click_destinations"
SELECT (jsonb_populate_record(NULL::"brand_click_destinations",
        to_jsonb(x) || jsonb_build_object('org_id', o."org_id"))).*
  FROM "brand_click_destinations" x
  JOIN "org_brands" o ON o."brand_id" = x."brand_id"
 WHERE x."org_id" IS NULL
   AND o."org_id" <> (SELECT o2."org_id" FROM "org_brands" o2 WHERE o2."brand_id" = x."brand_id"
                       ORDER BY o2."claimed_at" ASC, o2."org_id" ASC LIMIT 1);--> statement-breakpoint

INSERT INTO "brand_whatsapp_links"
SELECT (jsonb_populate_record(NULL::"brand_whatsapp_links",
        to_jsonb(x) || jsonb_build_object('org_id', o."org_id"))).*
  FROM "brand_whatsapp_links" x
  JOIN "org_brands" o ON o."brand_id" = x."brand_id"
 WHERE x."org_id" IS NULL
   AND o."org_id" <> (SELECT o2."org_id" FROM "org_brands" o2 WHERE o2."brand_id" = x."brand_id"
                       ORDER BY o2."claimed_at" ASC, o2."org_id" ASC LIMIT 1);--> statement-breakpoint

INSERT INTO "brand_business_context"
SELECT (jsonb_populate_record(NULL::"brand_business_context",
        to_jsonb(x) || jsonb_build_object('org_id', o."org_id"))).*
  FROM "brand_business_context" x
  JOIN "org_brands" o ON o."brand_id" = x."brand_id"
 WHERE x."org_id" IS NULL
   AND o."org_id" <> (SELECT o2."org_id" FROM "org_brands" o2 WHERE o2."brand_id" = x."brand_id"
                       ORDER BY o2."claimed_at" ASC, o2."org_id" ASC LIMIT 1);--> statement-breakpoint

-- `brand_user_fields` carries its own uuid primary key, so each copy needs a
-- fresh one or the insert collides with the row it was copied from.
INSERT INTO "brand_user_fields"
SELECT (jsonb_populate_record(NULL::"brand_user_fields",
        to_jsonb(x) || jsonb_build_object('org_id', o."org_id", 'id', gen_random_uuid()))).*
  FROM "brand_user_fields" x
  JOIN "org_brands" o ON o."brand_id" = x."brand_id"
 WHERE x."org_id" IS NULL
   AND o."org_id" <> (SELECT o2."org_id" FROM "org_brands" o2 WHERE o2."brand_id" = x."brand_id"
                       ORDER BY o2."claimed_at" ASC, o2."org_id" ASC LIMIT 1);--> statement-breakpoint

-- The original rows (and the two never-copied tables) go to the first claimer.
UPDATE "brand_sales_economics" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_click_destinations" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_whatsapp_links" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_business_context" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_user_fields" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_share_tokens" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint
UPDATE "brand_sales_funnels" x SET "org_id" = (
  SELECT o."org_id" FROM "org_brands" o WHERE o."brand_id" = x."brand_id"
   ORDER BY o."claimed_at" ASC, o."org_id" ASC LIMIT 1
) WHERE x."org_id" IS NULL;--> statement-breakpoint

-- Archived above; unreachable by construction.
DELETE FROM "brand_sales_economics" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_click_destinations" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_whatsapp_links" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_business_context" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_user_fields" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_share_tokens" WHERE "org_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_sales_funnels" WHERE "org_id" IS NULL;--> statement-breakpoint

ALTER TABLE "brand_sales_economics" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_click_destinations" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_whatsapp_links" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_business_context" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_share_tokens" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "brand_sales_economics" ADD CONSTRAINT "brand_sales_economics_org_id_brand_id_pk" PRIMARY KEY ("org_id", "brand_id");--> statement-breakpoint
ALTER TABLE "brand_click_destinations" ADD CONSTRAINT "brand_click_destinations_org_id_brand_id_pk" PRIMARY KEY ("org_id", "brand_id");--> statement-breakpoint
ALTER TABLE "brand_whatsapp_links" ADD CONSTRAINT "brand_whatsapp_links_org_id_brand_id_pk" PRIMARY KEY ("org_id", "brand_id");--> statement-breakpoint
ALTER TABLE "brand_business_context" ADD CONSTRAINT "brand_business_context_org_id_brand_id_pk" PRIMARY KEY ("org_id", "brand_id");--> statement-breakpoint
ALTER TABLE "brand_share_tokens" ADD CONSTRAINT "brand_share_tokens_org_id_brand_id_pk" PRIMARY KEY ("org_id", "brand_id");--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_org_id_brand_id_funnel_key_pk" PRIMARY KEY ("org_id", "brand_id", "funnel_key");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "brand_user_fields_org_id_brand_id_field_key_key"
  ON "brand_user_fields" USING btree ("org_id", "brand_id", "field_key");--> statement-breakpoint

-- 4. A funnel switched off keeps its numbers, so the row is never deleted. ----
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- 5. The declaration marker is redundant now. --------------------------------
-- With "an org that has answered always has at least one ACTIVE funnel", zero
-- rows is the only way to say "never answered", so the separate marker table
-- has nothing left to record. It never held a single row in any environment.
DROP TABLE IF EXISTS "brand_sales_funnel_declarations" CASCADE;--> statement-breakpoint

-- 6. The goal is gone from the shared identity row (copied in step 1). -------
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_current_goal_check";--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN IF EXISTS "current_goal";
