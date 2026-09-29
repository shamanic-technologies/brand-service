-- HOW AN OFFER SELLS: the funnel steps and legs the customer selected for one
-- offer (features-service step keys + leg keys, stored as given). Additive: a
-- new table, no existing read or write touches it. No row = never stated.
CREATE TABLE IF NOT EXISTS "brand_offer_sales_paths" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"steps" text[] NOT NULL,
	"leg_keys" text[] NOT NULL,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_offer_sales_paths_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade
);
