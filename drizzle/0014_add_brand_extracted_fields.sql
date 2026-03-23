CREATE TABLE IF NOT EXISTS "brand_extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_value" jsonb,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extracted_fields_expires" ON "brand_extracted_fields" USING btree ("expires_at" ASC NULLS LAST);--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" ADD CONSTRAINT "brand_extracted_fields_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" ADD CONSTRAINT "brand_extracted_fields_brand_id_field_key_key" UNIQUE("brand_id","field_key");
