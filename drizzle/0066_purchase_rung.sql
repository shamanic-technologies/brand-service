-- The PURCHASE becomes its own rung of `sales_from_website`.
--
-- That funnel shipped one release earlier as Website visit -> Paid client, with
-- nothing between the visit and the sale and one rate pricing the whole of it:
-- `visit_to_close_pct`. Owner decision: for a brand whose buyer lands and buys,
-- the purchase is a step in its own right — the same way a signup is a step on
-- `website_purchases` and a filled form is one on `form_magnet` — so the funnel
-- now reads Website visit -> Purchase -> Paid client. The purchase is the ORDER
-- PLACED, the sale is the MONEY KEPT, and the arrow between them is where a
-- refund lives.
--
-- Nullable with no default, like every other rate on this table: a value the
-- brand never stated reads back NULL, which never means zero.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "visit_to_purchase_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "purchase_to_paid_client_pct" numeric(7, 4);--> statement-breakpoint

-- Carry over what the brands that already declared this funnel STATED.
--
-- A declaration made before this reshape says one thing: "this share of my
-- visitors becomes a paid client". Under two arrows the ONLY decomposition that
-- preserves that sentence is the whole of it on the first arrow and 100% on the
-- second — any other split changes the number the brand gave us. So 100 is not
-- an invented rate, it is the identity that keeps their statement exactly true:
-- visit_to_purchase_pct * 100 / 100 = visit_to_close_pct.
--
-- Leaving the second arrow NULL was the alternative and is worse: a consumer
-- multiplying the chain would price nothing, so a funnel that worked yesterday
-- would silently stop being priced today.
--
-- Guarded on the first arrow being unset so a re-run cannot overwrite a number
-- a customer has since typed, and scoped to this funnel because it is the only
-- one `visit_to_close_pct` ever priced.
UPDATE "brand_sales_funnels"
   SET "visit_to_purchase_pct" = "visit_to_close_pct",
       "purchase_to_paid_client_pct" = 100
 WHERE "funnel_key" = 'sales_from_website'
   AND "visit_to_close_pct" IS NOT NULL
   AND "visit_to_purchase_pct" IS NULL
   AND "purchase_to_paid_client_pct" IS NULL;
