CREATE TABLE IF NOT EXISTS "brand_sales_funnel_declarations" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnel_declarations_brand_id_fkey') THEN
		ALTER TABLE "brand_sales_funnel_declarations" ADD CONSTRAINT "brand_sales_funnel_declarations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
