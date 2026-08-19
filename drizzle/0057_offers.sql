CREATE TABLE IF NOT EXISTS "brand_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"migrated_from_brand_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_offers_name_check" CHECK (char_length(btrim("brand_offers"."name")) BETWEEN 1 AND 20 AND array_length(regexp_split_to_array(btrim("brand_offers"."name"), '\s+'), 1) <= 2)
);
--> statement-breakpoint
DROP INDEX IF EXISTS "brand_user_fields_org_id_brand_id_field_key_key";--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_org_id_brand_id_funnel_key_pk";--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "offer_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_offers_brand_id_fkey') THEN
		ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offers_org_id_brand_id_lower_name_key" ON "brand_offers" USING btree ("org_id","brand_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_offers_org_id_brand_id_idx" ON "brand_offers" USING btree ("org_id","brand_id");--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_offer_id_fkey') THEN
		ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_user_fields_offer_id_fkey') THEN
		ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_org_brand_offer_funnel_key') THEN
		ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_org_brand_offer_funnel_key" UNIQUE NULLS NOT DISTINCT("org_id","brand_id","offer_id","funnel_key");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_user_fields_org_brand_offer_field_key') THEN
		ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_org_brand_offer_field_key" UNIQUE NULLS NOT DISTINCT("org_id","brand_id","offer_id","field_key");
	END IF;
END $$;
