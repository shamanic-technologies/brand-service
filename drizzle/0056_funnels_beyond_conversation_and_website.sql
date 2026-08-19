-- The legs of the three chains that begin somewhere other than a conversation
-- leading to a meeting, or the brand's own website.
--
--   sales_from_conversation   Positive reply -> Paid client
--   sales_meetings_from_ads   Ad click -> Meeting booked -> Meeting attended -> Paid client
--   lead_forms_from_ads       Ad click -> Lead form submitted -> Paid client
--
-- Nullable with no default, like every other rate on this table: a value the
-- brand never stated reads back NULL, which never means zero. None of these has
-- a counterpart column on `brand_sales_economics` — that brand-wide record
-- predates these chains — so nothing backfills into them and they are stated on
-- the funnel or not at all.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "reply_to_paid_client_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "ad_click_to_meeting_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "ad_click_to_lead_form_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "lead_form_to_paid_client_pct" numeric(7, 4);--> statement-breakpoint

-- The vocabulary the column accepts. WIDENED, never renamed: every key already
-- stored keeps its exact spelling, so live brands and the budgets that reference
-- them are untouched. The constraint is DROPPED and re-added rather than
-- widened in place — Postgres has no ALTER CONSTRAINT for a CHECK expression —
-- and the drop is idempotent, so a re-run lands on the same constraint.
ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_funnel_key_check";--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_funnel_key_check" CHECK ("funnel_key" IN ('sales_meetings_from_conversation', 'sales_meetings_from_website', 'website_purchases', 'form_magnet', 'sales_from_conversation', 'sales_meetings_from_ads', 'lead_forms_from_ads'));
