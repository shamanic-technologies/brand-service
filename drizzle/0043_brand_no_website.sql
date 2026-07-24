CREATE TABLE IF NOT EXISTS "brand_business_context" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "domain" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_business_context_brand_id_fkey') THEN
		ALTER TABLE "brand_business_context" ADD CONSTRAINT "brand_business_context_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
