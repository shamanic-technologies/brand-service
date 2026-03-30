CREATE TABLE "brand_extracted_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"category_key" text NOT NULL,
	"original_url" text NOT NULL,
	"permanent_url" text NOT NULL,
	"description" text,
	"width" integer,
	"height" integer,
	"format" text,
	"size_bytes" integer,
	"relevance_score" numeric,
	"source_page_url" text,
	"campaign_id" uuid,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_extracted_images" ADD CONSTRAINT "brand_extracted_images_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_extracted_images_brand_category" ON "brand_extracted_images" USING btree ("brand_id","category_key");
--> statement-breakpoint
CREATE INDEX "idx_extracted_images_expires" ON "brand_extracted_images" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "idx_extracted_images_campaign" ON "brand_extracted_images" USING btree ("campaign_id");
