-- EVERY OFFER KNOWS ITS SALES STEPS (owner 2026-10-18, CeXO). brand-service
-- assesses, per offer, which catalogue steps its business has (Jev), and stores
-- the list in the same `steps` column the client states. `steps_source` tells
-- the two apart; every existing row was stated by the client (or the Copilot on
-- the client's word), hence the default. Additive, no data moved.
ALTER TABLE "brand_offer_sales_paths" ADD COLUMN IF NOT EXISTS "steps_source" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_offer_sales_paths" ADD COLUMN IF NOT EXISTS "steps_assessment" jsonb;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_offer_sales_paths_steps_source_check') THEN
    ALTER TABLE "brand_offer_sales_paths" ADD CONSTRAINT "brand_offer_sales_paths_steps_source_check" CHECK ("steps_source" IN ('client', 'assessed'));
  END IF;
END $$;
