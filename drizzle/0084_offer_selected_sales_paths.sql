-- Which SALES PATHS the customer SELECTED (ticked) on an offer: features-service
-- combinationKeys, stored AS GIVEN. A plain stated list like brand_offer_channels
-- (0082), NOT the per-offer activation store dropped by 0083: no uniqueness
-- across paths, no history, no money. Additive: one new table nothing reads yet.
--
-- No row = never stated; a row with an empty list = stated, none selected.
CREATE TABLE IF NOT EXISTS "brand_offer_selected_sales_paths" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"combination_keys" text[] NOT NULL,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stated_by_user_id" text,
	CONSTRAINT "brand_offer_selected_sales_paths_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade
);
