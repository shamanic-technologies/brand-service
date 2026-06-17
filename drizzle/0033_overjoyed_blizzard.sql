ALTER TABLE "brand_personas" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "brand_personas" ADD COLUMN IF NOT EXISTS "avatar_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_personas" ADD COLUMN IF NOT EXISTS "avatar_generated_at" timestamp with time zone;
