ALTER TABLE "brand_extracted_fields" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" DROP CONSTRAINT "brand_extracted_fields_brand_id_field_key_key";--> statement-breakpoint
CREATE UNIQUE INDEX "brand_extracted_fields_brand_field_campaign_key" ON "brand_extracted_fields" ("brand_id", "field_key", "campaign_id") WHERE "campaign_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_extracted_fields_brand_field_no_campaign_key" ON "brand_extracted_fields" ("brand_id", "field_key") WHERE "campaign_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_extracted_fields_campaign" ON "brand_extracted_fields" USING btree ("campaign_id" ASC NULLS LAST);
