ALTER TABLE "brand_icp_suggestions" DROP CONSTRAINT "brand_icp_suggestions_brand_id_key";--> statement-breakpoint
ALTER TABLE "brand_icp_suggestions" ADD COLUMN "target_audience" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_icp_suggestions" ADD CONSTRAINT "brand_icp_suggestions_brand_id_target_audience_key" UNIQUE("brand_id","target_audience");
