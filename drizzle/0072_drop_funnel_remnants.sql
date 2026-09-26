-- WAVE C2 — delete what is left of the sales funnel (distribute.you#4413).
-- Rates live per LEG (`brand_leg_rates`, 0071), lifetime revenue per OFFER
-- (`brand_offers`, 0071). This drops the two funnel stores nothing reads any more:
--
--   * `brand_funnel_arrow_rates` — the brand-grain per-FUNNEL rates, carried over
--     onto `brand_leg_rates` by 0071 (prod 2026-09-26: 243 rows).
--   * `brand_sales_economics.funnel_stages` — a multi-select no consumer reads
--     (prod 2026-09-26: 109 rows, 29 non-empty).
--
-- KEPT on purpose: `brand_sales_funnels` + `brand_sales_funnel_arrow_rates`, read
-- only by `GET /internal/offers/:offerId/sales-funnels`, which client-service
-- (reward-tasks) and workflow-service (AI meeting-booking) still call in prod.
--
-- SNAPSHOT FIRST, IN THE SAME TRANSACTION. Every dropped row is copied into a
-- dated snapshot table, the copy is COUNTED against its source, and the drop only
-- runs when the two agree — otherwise the migration raises, the transaction rolls
-- back, and nothing is dropped. A pg_dump of both was also written to
-- /root/distribute/backups/ on the box before this shipped.

CREATE TABLE IF NOT EXISTS "brand_funnel_arrow_rates_funnel_snapshot_20260926" AS
  SELECT * FROM "brand_funnel_arrow_rates";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_sales_economics_funnel_stages_snapshot_20260926" AS
  SELECT "org_id", "brand_id", "funnel_stages", "updated_at" FROM "brand_sales_economics";--> statement-breakpoint
DO $$
DECLARE
  src bigint;
  snap bigint;
BEGIN
  SELECT count(*) INTO src FROM "brand_funnel_arrow_rates";
  SELECT count(*) INTO snap FROM "brand_funnel_arrow_rates_funnel_snapshot_20260926";
  IF src <> snap THEN
    RAISE EXCEPTION 'C2 snapshot mismatch: brand_funnel_arrow_rates has % rows, snapshot has %', src, snap;
  END IF;
  SELECT count(*) INTO src FROM "brand_sales_economics";
  SELECT count(*) INTO snap FROM "brand_sales_economics_funnel_stages_snapshot_20260926";
  IF src <> snap THEN
    RAISE EXCEPTION 'C2 snapshot mismatch: brand_sales_economics has % rows, snapshot has %', src, snap;
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "brand_funnel_arrow_rates";--> statement-breakpoint
ALTER TABLE "brand_sales_economics" DROP COLUMN IF EXISTS "funnel_stages";
