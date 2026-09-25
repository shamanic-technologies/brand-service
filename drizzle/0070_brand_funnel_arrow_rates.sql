-- BRAND-GRAIN FUNNEL RATES (2026-09-25) — a brand's conversion rates describe how
-- that BRAND sells, so there is ONE stated rate per (org, brand, funnel, arrow),
-- shared by every offer of the brand selling that funnel. Lifetime revenue and the
-- booking link stay per offer (an offer is what is sold, and two offers can be
-- worth very different amounts); only the RATES move up.
--
-- Purely additive: a new table. The per-offer rates (`brand_sales_funnels` named
-- columns + `brand_sales_funnel_arrow_rates`) are untouched and keep answering
-- every current reader until they move to this table.
--
-- ABSENCE IS THE ANSWER: no row = the brand has not stated this arrow. `rate_pct`
-- is NOT NULL with NO default; clearing a rate deletes the row, so "not stated"
-- is exactly one state.
CREATE TABLE IF NOT EXISTS "brand_funnel_arrow_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"funnel_key" text NOT NULL,
	"from_step" text NOT NULL,
	"to_step" text NOT NULL,
	"rate_pct" numeric(7, 4) NOT NULL,
	"migrated_from_offer_id" uuid,
	"migrated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_funnel_arrow_rates_steps_not_blank" CHECK (btrim("from_step") <> '' AND btrim("to_step") <> ''),
	CONSTRAINT "brand_funnel_arrow_rates_rate_range" CHECK ("rate_pct" >= 0 AND "rate_pct" <= 100)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_funnel_arrow_rates" ADD CONSTRAINT "brand_funnel_arrow_rates_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_funnel_arrow_rates_brand_key" ON "brand_funnel_arrow_rates" USING btree ("org_id","brand_id","funnel_key","from_step","to_step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_funnel_arrow_rates_brand_id_idx" ON "brand_funnel_arrow_rates" USING btree ("brand_id");
