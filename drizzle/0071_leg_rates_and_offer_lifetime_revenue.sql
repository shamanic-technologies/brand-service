-- LEG-GRAIN RATES + PER-OFFER LIFETIME REVENUE (2026-09-25) — the sales funnel is
-- being retired. A conversion rate is stated per (org, brand, LEG), a leg being
-- the move from one step to another; the funnel is no longer part of its key. A
-- lifetime revenue is stated per OFFER (what the offer sells is worth it), no
-- longer once per (offer, funnel).
--
-- ADDITIVE. `brand_funnel_arrow_rates` and `brand_sales_funnels` keep every row
-- and keep answering every funnel-keyed read byte for byte.
--
-- CARRY-OVER (measured in prod before shipping, 2026-09-25):
--   * legs: 243 brand-grain funnel rows over 107 (org, brand) pairs collapse to
--     242 (org, brand, leg) rows; ONE leg sits in two funnels and both state the
--     same rate; ZERO legs carry conflicting rates. Rule, for completeness: the
--     most recently stated rate of the leg wins (tie → funnel key order).
--   * lifetime revenue: 115 offers state one on at least one funnel; 11 state it
--     on several funnels; ONE offer states two different values (org f0420eb5,
--     offer 832126f3: website_purchases $500 on 09-15 vs
--     sales_meetings_from_conversation $175 on 08-16). Rule: the most recently
--     stated value wins ($500).
-- Only NULL targets are filled, so a re-run (or a statement made at the new grain
-- first) is never overwritten.

CREATE TABLE IF NOT EXISTS "brand_leg_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"from_step" text NOT NULL,
	"to_step" text NOT NULL,
	"rate_pct" numeric(7, 4) NOT NULL,
	"carried_over_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_leg_rates_steps_not_blank" CHECK (btrim("from_step") <> '' AND btrim("to_step") <> ''),
	CONSTRAINT "brand_leg_rates_distinct_steps" CHECK ("from_step" <> "to_step"),
	CONSTRAINT "brand_leg_rates_rate_range" CHECK ("rate_pct" >= 0 AND "rate_pct" <= 100)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_leg_rates" ADD CONSTRAINT "brand_leg_rates_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_leg_rates_brand_key" ON "brand_leg_rates" USING btree ("org_id","brand_id","from_step","to_step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_leg_rates_brand_id_idx" ON "brand_leg_rates" USING btree ("brand_id");--> statement-breakpoint
ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "lifetime_revenue_usd" integer;--> statement-breakpoint
ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "lifetime_revenue_stated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "lifetime_revenue_carried_over_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_lifetime_revenue_non_negative" CHECK ("lifetime_revenue_usd" IS NULL OR "lifetime_revenue_usd" >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
INSERT INTO "brand_leg_rates" ("org_id", "brand_id", "from_step", "to_step", "rate_pct", "carried_over_at", "created_at", "updated_at")
SELECT DISTINCT ON ("org_id", "brand_id", "from_step", "to_step")
	"org_id", "brand_id", "from_step", "to_step", "rate_pct", now(), "updated_at", "updated_at"
FROM "brand_funnel_arrow_rates"
WHERE "from_step" <> "to_step"
ORDER BY "org_id", "brand_id", "from_step", "to_step", "updated_at" DESC, "funnel_key"
ON CONFLICT ("org_id", "brand_id", "from_step", "to_step") DO NOTHING;--> statement-breakpoint
UPDATE "brand_offers" o
SET "lifetime_revenue_usd" = s."lifetime_revenue_usd",
	"lifetime_revenue_stated_at" = s."updated_at",
	"lifetime_revenue_carried_over_at" = now()
FROM (
	SELECT DISTINCT ON ("offer_id") "offer_id", "lifetime_revenue_usd", "updated_at"
	FROM "brand_sales_funnels"
	WHERE "offer_id" IS NOT NULL AND "lifetime_revenue_usd" IS NOT NULL
	ORDER BY "offer_id", "updated_at" DESC, "funnel_key"
) s
WHERE o."id" = s."offer_id" AND o."lifetime_revenue_usd" IS NULL;
