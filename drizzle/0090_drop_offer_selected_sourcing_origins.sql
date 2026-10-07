-- Per-offer SELECTED SOURCING ORIGINS (0087) are retired: the owner made each lead
-- source its own CAMPAIGN with On/Off (campaign-service) and a budget (billing)
-- on 2026-10-07, so nothing reads or writes this table. In production it held one
-- row, a staff probe (offer d5ecba00-783a-4939-b5bd-f85b9e6b7d9e, stated
-- 2026-10-07 11:32 UTC); backup
-- /root/backups/manual/brand_offer_selected_sourcing_origins_retire_20261007.sql.gz
-- on the box. The DO block refuses the drop if any OTHER row was written since,
-- so no customer statement is ever lost silently.
DO $$
DECLARE
  foreign_rows boolean;
BEGIN
  IF to_regclass('public.brand_offer_selected_sourcing_origins') IS NOT NULL THEN
    -- EXECUTE, so the query is only planned when the table exists.
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM brand_offer_selected_sourcing_origins
             WHERE offer_id <> ''d5ecba00-783a-4939-b5bd-f85b9e6b7d9e'')' INTO foreign_rows;
    IF foreign_rows THEN
      RAISE EXCEPTION 'brand_offer_selected_sourcing_origins holds rows beyond the staff probe: refusing to drop';
    END IF;
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "brand_offer_selected_sourcing_origins";
