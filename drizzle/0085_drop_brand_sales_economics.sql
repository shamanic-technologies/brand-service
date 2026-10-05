-- Brand-level SALES ECONOMICS are retired (owner decision 2026-10-05). The
-- economics every figure prices on live on the OFFER (lifetime revenue per
-- offer, brand_leg_rates per leg), which stay. brand_sales_economics had no
-- write since 2026-08-03 and no live reader: features-service stopped reading
-- it in v0.179.64, and the routes that served it are deleted in the same ship.
--
-- Backup taken before this ran: /root/backups/manual/
-- brand_sales_economics_retire_20261005.sql.gz on the box (107 rows, plus the
-- 109-row 20260926 funnel-stages snapshot dropped below).
--
-- The DO block refuses the drop if any row was written after the last known
-- write, so nothing written since the backup is ever lost silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "brand_sales_economics"
     WHERE "updated_at" > '2026-08-03 16:27:27+00' OR "created_at" > '2026-08-03 16:27:27+00'
  ) THEN
    RAISE EXCEPTION 'brand_sales_economics was written after the backup: refusing to drop';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "brand_sales_economics";--> statement-breakpoint
DROP TABLE IF EXISTS "brand_sales_economics_funnel_stages_snapshot_20260926";
