-- Which CHANNELS an offer accepts, and which SALES PATHS the customer ACTIVATED
-- on it. Additive: two new tables, no existing read or write touches them.
--
-- brand_offer_channels: no row = never stated; a row with an empty list =
-- stated, none accepted. Two different answers, by construction.
--
-- brand_offer_active_sales_paths: append-only history. At most one ACTIVE row
-- per entry (channel x entry leg) and per combination (partial unique indexes);
-- ending a row sets ended_at + end_reason, never deletes it. No money columns:
-- budgets are billing-service's.
CREATE TABLE IF NOT EXISTS "brand_offer_channels" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"channel_slugs" text[] NOT NULL,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stated_by_user_id" text,
	CONSTRAINT "brand_offer_channels_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_offer_active_sales_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"combination_key" text NOT NULL,
	"entry_channel_slug" text NOT NULL,
	"entry_leg_key" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by_user_id" text,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" text,
	"end_reason" text,
	"replaced_by_id" uuid,
	CONSTRAINT "brand_offer_active_sales_paths_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade,
	CONSTRAINT "brand_offer_active_sales_paths_end_reason" CHECK (end_reason IS NULL OR end_reason IN ('deactivated', 'replaced')),
	CONSTRAINT "brand_offer_active_sales_paths_ended_has_reason" CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
	CONSTRAINT "brand_offer_active_sales_paths_replaced_has_successor" CHECK ((end_reason = 'replaced') = (replaced_by_id IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offer_active_sales_paths_one_per_entry" ON "brand_offer_active_sales_paths" USING btree ("offer_id","entry_channel_slug","entry_leg_key") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offer_active_sales_paths_one_per_combination" ON "brand_offer_active_sales_paths" USING btree ("offer_id","combination_key") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_offer_active_sales_paths_offer_idx" ON "brand_offer_active_sales_paths" USING btree ("offer_id");
