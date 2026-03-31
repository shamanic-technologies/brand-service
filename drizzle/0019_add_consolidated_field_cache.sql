CREATE TABLE IF NOT EXISTS "consolidated_field_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"field_values" jsonb NOT NULL,
	"brand_ids" jsonb NOT NULL,
	"field_keys" jsonb NOT NULL,
	"campaign_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consolidated_field_cache_key_idx" ON "consolidated_field_cache" USING btree ("cache_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consolidated_field_cache_expires" ON "consolidated_field_cache" USING btree ("expires_at");
