CREATE TABLE IF NOT EXISTS "brand_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_personas_brand_id_fkey') THEN
		ALTER TABLE "brand_personas" ADD CONSTRAINT "brand_personas_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_profile_versions_brand_id_fkey') THEN
		ALTER TABLE "brand_profile_versions" ADD CONSTRAINT "brand_profile_versions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_personas_brand_id_lower_name_key" ON "brand_personas" USING btree ("brand_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_personas_brand_id_idx" ON "brand_personas" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_profile_versions_brand_id_version_key" ON "brand_profile_versions" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_profile_versions_brand_id_idx" ON "brand_profile_versions" USING btree ("brand_id");
