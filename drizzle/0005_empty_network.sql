ALTER TABLE "brand_icp_suggestions" DROP CONSTRAINT IF EXISTS "brand_icp_suggestions_brand_id_key";--> statement-breakpoint
ALTER TABLE "brand_icp_suggestions" ADD COLUMN IF NOT EXISTS "target_audience" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_icp_suggestions_brand_id_target_audience_key') THEN
    ALTER TABLE "brand_icp_suggestions" ADD CONSTRAINT "brand_icp_suggestions_brand_id_target_audience_key" UNIQUE("brand_id","target_audience");
  END IF;
END $$;
