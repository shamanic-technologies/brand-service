-- Split the self-serve close metric into two sub-rates:
--   visit_to_signup_pct (visit -> signup) and signup_to_paid_client_pct (signup -> paid client).
-- visit_to_close_pct is KEPT but becomes DERIVED = round(visit_to_signup_pct * signup_to_paid_client_pct / 100),
-- recomputed on every write so the revenue/projection engine keeps reading it unchanged.
--
-- The column-add + one-time backfill are guarded so they run ONLY when the
-- columns do not yet exist. Re-running must NOT clobber user-written sub-rates,
-- so the backfill (which derives from the legacy single rate) lives inside the
-- same existence guard as the ADD COLUMN.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'brand_sales_economics' AND column_name = 'visit_to_signup_pct'
  ) THEN
    ALTER TABLE "brand_sales_economics" ADD COLUMN "visit_to_signup_pct" integer DEFAULT 25 NOT NULL;
    ALTER TABLE "brand_sales_economics" ADD COLUMN "signup_to_paid_client_pct" integer DEFAULT 20 NOT NULL;

    -- Backfill existing rows from the legacy single close rate (one time only).
    -- visit_to_signup = LEAST(close * 5, 100); signup_to_paid = 20.
    UPDATE "brand_sales_economics"
       SET "visit_to_signup_pct" = LEAST("visit_to_close_pct" * 5, 100),
           "signup_to_paid_client_pct" = 20;

    -- Recompute the derived close rate so it stays coherent with the sub-rates
    -- (5N * 20 / 100 = N, capped) -- existing values change only above the cap.
    UPDATE "brand_sales_economics"
       SET "visit_to_close_pct" = ROUND("visit_to_signup_pct" * "signup_to_paid_client_pct" / 100.0);
  END IF;
END $$;
--> statement-breakpoint
-- Strip the dropped 'website_signup' funnel stage from stored arrays so reads do
-- not fail the tightened enum. Idempotent: the WHERE clause no-ops once stripped.
UPDATE "brand_sales_economics"
   SET "funnel_stages" = COALESCE(
     (SELECT jsonb_agg(v) FROM jsonb_array_elements_text("funnel_stages") v WHERE v <> 'website_signup'),
     '[]'::jsonb
   )
 WHERE "funnel_stages" @> '"website_signup"'::jsonb;
