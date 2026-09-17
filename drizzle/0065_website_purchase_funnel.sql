-- The funnel a brand can declare when its buyer lands on the site and PAYS,
-- with nothing in between: `sales_from_website` (Website visit -> Paid client).
-- Every other website funnel inserts a rung (a signup, a form, a meeting), so
-- an ecommerce brand had nothing it could declare while already stating the
-- exact rate that prices it.
--
-- Nullable with no default, like every other rate on this table: a value the
-- brand never stated reads back NULL, which never means zero. It shares its
-- name with `brand_sales_economics.visit_to_close_pct` (which is DERIVED there)
-- and nothing backfills between the two — this is stated on the funnel or not
-- at all.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "visit_to_close_pct" numeric(7, 4);--> statement-breakpoint

-- The vocabulary the column accepts. WIDENED, never renamed: every key already
-- stored keeps its exact spelling, so the four funnels carrying declarations
-- (and the billing ceilings keyed on them) are untouched. Dropped and re-added
-- rather than widened in place — Postgres has no ALTER CONSTRAINT for a CHECK
-- expression — and the drop is idempotent, so a re-run lands on the same
-- constraint.
ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_funnel_key_check";--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_funnel_key_check" CHECK ("funnel_key" IN ('sales_meetings_from_conversation', 'sales_meetings_from_website', 'website_purchases', 'form_magnet', 'sales_from_conversation', 'sales_meetings_from_ads', 'lead_forms_from_ads', 'sales_from_website'));
