-- The PURCHASE became its own rung of `sales_from_website` (Website visit ->
-- Purchase -> Paid client), owner-decided 2026-09-18: a DTC buyer buying on the
-- site is a step a customer names, the way a signup or a filled form is on the
-- sibling website funnels. Two legs, two named rates.
--
-- Nullable with no default, like every other rate on this table: a value the
-- brand never stated reads back NULL, which never means zero. No brand had
-- declared `sales_from_website` when the rung was added (zero rows in
-- production), so nothing is backfilled from `visit_to_close_pct`, which stays
-- as a column no funnel's leg is priced on any more.
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "visit_to_purchase_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "purchase_to_paid_client_pct" numeric(7, 4);
