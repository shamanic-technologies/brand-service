-- The PURCHASE becomes its own rung of `sales_from_website`, so that funnel
-- reads Website visit -> Purchase -> Paid client instead of collapsing the two
-- into one arrow. One arrow became two, so the funnel needs two columns where
-- it had `visit_to_close_pct`.
--
-- Nullable with no default, like every other rate on this table: a value the
-- brand never stated reads back NULL, which never means zero.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "visit_to_purchase_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "purchase_to_paid_client_pct" numeric(7, 4);--> statement-breakpoint

-- Carry forward what a brand already stated for the arrow that no longer
-- exists. `visit_to_close_pct` was the share of visitors who ended up a paid
-- client with nothing in between, so on the three-rung funnel it is the share
-- who BUY (`visit_to_purchase_pct`), and every purchase on a DTC site IS the
-- paid client (100). The product of the two arrows is therefore exactly the
-- rate the brand stated: no number is invented and no end-to-end rate moves.
--
-- `visit_to_close_pct` is NOT dropped, which is what makes this reversible by
-- an exact predicate rather than by a timestamp: the original value is still in
-- its own column. The `IS NULL` guard makes a re-run a no-op and stops a second
-- run from overwriting a rate a customer has since restated.
--
-- Measured 2026-09-18 against production: ZERO rows carry `sales_from_website`
-- (the funnel shipped the day before), so this statement updates nothing today.
-- It exists for the row that may be declared between this merge and its deploy.
UPDATE "brand_sales_funnels"
SET "visit_to_purchase_pct" = "visit_to_close_pct",
    "purchase_to_paid_client_pct" = 100
WHERE "funnel_key" = 'sales_from_website'
  AND "visit_to_close_pct" IS NOT NULL
  AND "visit_to_purchase_pct" IS NULL;--> statement-breakpoint

-- The same carry-forward for the ARROW table, and only for the arrows the
-- one-time named-column backfill wrote there (`backfilled_at` NOT NULL). Those
-- rows are a machine copy of the column this migration has just moved, so
-- leaving them would serve a stale Website visit -> Paid client arrow beside
-- the funnel's real two. An arrow a CUSTOMER stated (`backfilled_at` NULL) is
-- never touched: it is a number somebody typed, and it stays readable as an
-- arrow the catalogue does not name.
DELETE FROM "brand_sales_funnel_arrow_rates"
WHERE "funnel_key" = 'sales_from_website'
  AND "from_step" = 'Website visit'
  AND "to_step" = 'Paid client'
  AND "backfilled_at" IS NOT NULL;
