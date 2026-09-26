-- WAVE C3 — the last of the sales funnel leaves brand-service (distribute.you#4413).
-- `GET /internal/offers/:offerId/sales-funnels` was the only reader of these two
-- frozen tables; every production caller (client-service reward-tasks,
-- workflow-service AI meeting-booking, sales-lead-service, instantly-service,
-- features-service) moved to the leg / offer reads, so the route is deleted and
-- the tables with it:
--
--   * `brand_sales_funnels` — per-(offer, funnel) declarations, frozen since C2.
--   * `brand_sales_funnel_arrow_rates` — their per-arrow rates, frozen since C2.
--
-- Rates live per LEG (`brand_leg_rates`), lifetime revenue per OFFER
-- (`brand_offers`), both carried over by 0071; the booking link and click
-- destination moved onto `brand_offers` in 0073.
--
-- SNAPSHOT FIRST, IN THE SAME TRANSACTION, created by the migration itself so it
-- is owned by the service's own role. Every dropped row is copied into a dated
-- snapshot table, the copy is COUNTED against its source, and the drop only runs
-- when the two agree — otherwise the migration raises, the transaction rolls
-- back, and nothing is dropped. A pg_dump of both tables was also written to
-- /root/distribute/backups/ on the box before this shipped.

CREATE TABLE IF NOT EXISTS "brand_sales_funnels_c3_snapshot_20260926" AS
  SELECT * FROM "brand_sales_funnels";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_sales_funnel_arrow_rates_c3_snapshot_20260926" AS
  SELECT * FROM "brand_sales_funnel_arrow_rates";--> statement-breakpoint
DO $$
DECLARE
  src bigint;
  snap bigint;
BEGIN
  SELECT count(*) INTO src FROM "brand_sales_funnels";
  SELECT count(*) INTO snap FROM "brand_sales_funnels_c3_snapshot_20260926";
  IF src <> snap THEN
    RAISE EXCEPTION 'C3 snapshot mismatch: brand_sales_funnels has % rows, snapshot has %', src, snap;
  END IF;
  SELECT count(*) INTO src FROM "brand_sales_funnel_arrow_rates";
  SELECT count(*) INTO snap FROM "brand_sales_funnel_arrow_rates_c3_snapshot_20260926";
  IF src <> snap THEN
    RAISE EXCEPTION 'C3 snapshot mismatch: brand_sales_funnel_arrow_rates has % rows, snapshot has %', src, snap;
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "brand_sales_funnel_arrow_rates";--> statement-breakpoint
DROP TABLE IF EXISTS "brand_sales_funnels";
