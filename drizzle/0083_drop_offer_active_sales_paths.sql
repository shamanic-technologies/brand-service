-- Per-offer ACTIVE SALES PATHS (0082) are withdrawn: the owner moved activation
-- to per-CAMPAIGN budgets in billing-service (2026-10-04), so nothing reads or
-- writes this table. It held 0 rows in production when this was written. The
-- DO block refuses the drop if anything was written since, so no row is ever
-- lost silently. brand_offer_channels (also 0082) stays.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "brand_offer_active_sales_paths") THEN
    RAISE EXCEPTION 'brand_offer_active_sales_paths holds rows: refusing to drop';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "brand_offer_active_sales_paths";
