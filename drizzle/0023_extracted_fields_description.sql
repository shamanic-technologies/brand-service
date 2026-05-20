-- Cache extracted fields by (brand_id, field_key, hash(field_description)).
-- Same key with different prompt descriptions = different cache slots.

ALTER TABLE "brand_extracted_fields"
  ADD COLUMN IF NOT EXISTS "field_description" text NOT NULL DEFAULT '';
--> statement-breakpoint

ALTER TABLE "brand_extracted_fields"
  ADD COLUMN IF NOT EXISTS "field_description_hash" text NOT NULL DEFAULT md5('');
--> statement-breakpoint

DROP INDEX IF EXISTS "idx_extracted_fields_brand_key_no_campaign";
--> statement-breakpoint

DROP INDEX IF EXISTS "idx_extracted_fields_brand_key_campaign";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_extracted_fields_brand_key_desc_no_campaign"
  ON "brand_extracted_fields" ("brand_id", "field_key", "field_description_hash")
  WHERE "campaign_id" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_extracted_fields_brand_key_desc_campaign"
  ON "brand_extracted_fields" ("brand_id", "field_key", "field_description_hash", "campaign_id")
  WHERE "campaign_id" IS NOT NULL;
