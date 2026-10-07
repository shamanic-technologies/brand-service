-- Which SOURCING ORIGINS the customer SELECTED (ticked) on an offer: features-service
-- sourcing origin slugs (e.g. sourcing-apollo-cold-filters), stored AS GIVEN. Same
-- plain stated list as brand_offer_selected_sales_paths (0084): no uniqueness, no
-- history, no money. Additive: one new table nothing reads yet.
--
-- No row = never stated; a row with an empty list = stated, none selected.
CREATE TABLE IF NOT EXISTS "brand_offer_selected_sourcing_origins" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"origin_slugs" text[] NOT NULL,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stated_by_user_id" text,
	CONSTRAINT "brand_offer_selected_sourcing_origins_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade
);
