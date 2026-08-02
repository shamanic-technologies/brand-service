-- Retire the goal vocabulary: the sales funnel is the only word for what a
-- brand sells through, and the four funnel keys are renamed to say so.
--
-- The rename is a pure relabelling of the SAME four chains, so it moves the
-- stored rows and the CHECK together. The pre-retirement spellings live on at
-- the wire, forever, resolved before anything reaches this column — see
-- `toSalesFunnelKey` in src/services/salesFunnelCatalogue.ts.
--
-- The declarations the retired goals imply are NOT written here. That is a
-- backfill over customer configuration, so it runs as its own idempotent,
-- reversible, dry-runnable script (scripts/backfill-funnel-declarations.ts)
-- whose result is read back from an independent query rather than from its own
-- log. This migration only makes the column able to hold what that script
-- writes.

-- The CHECK has to go first: the UPDATE below would violate it mid-statement.
ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_funnel_key_check";--> statement-breakpoint

-- The PK is (org_id, brand_id, funnel_key), and the rename is injective, so no
-- row can collide with another. Idempotent: a second run matches nothing.
UPDATE "brand_sales_funnels" SET "funnel_key" = 'sales_meetings_from_conversation' WHERE "funnel_key" = 'reply_meeting';--> statement-breakpoint
UPDATE "brand_sales_funnels" SET "funnel_key" = 'sales_meetings_from_website' WHERE "funnel_key" = 'visit_meeting';--> statement-breakpoint
UPDATE "brand_sales_funnels" SET "funnel_key" = 'website_purchases' WHERE "funnel_key" = 'visit_signup';--> statement-breakpoint
UPDATE "brand_sales_funnels" SET "funnel_key" = 'form_magnet' WHERE "funnel_key" = 'visit_form';--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_funnel_key_check') THEN
    ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_funnel_key_check" CHECK ("funnel_key" IN ('sales_meetings_from_conversation', 'sales_meetings_from_website', 'website_purchases', 'form_magnet'));
  END IF;
END $$;--> statement-breakpoint

-- Provenance for the backfill: the retired goal a row was derived from, NULL for
-- everything a user or a caller declared directly. It is what makes the backfill
-- reversible by an exact predicate and countable from a query that is not the
-- script's own output. Read by nothing at runtime.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "backfilled_from_goal" text;
