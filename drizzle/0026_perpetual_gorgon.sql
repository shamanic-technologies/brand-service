-- Brand-level sales conversion economics: one row per brand (PK = brand_id).
-- Hand-authored idempotent migration. drizzle-kit generate produced spurious
-- drift (it diffed schema.ts against meta snapshots that pre-date the
-- hand-authored 0024 silver/gold/bronze restructure); only this new table is
-- a real change. The 0026 meta snapshot is kept as-is — it now reflects the
-- true current schema.ts and repairs the baseline for future generates.
CREATE TABLE IF NOT EXISTS "brand_sales_economics" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"lifetime_revenue_usd" integer NOT NULL,
	"reply_to_meeting_pct" integer NOT NULL,
	"visit_to_meeting_pct" integer NOT NULL,
	"meeting_to_close_pct" integer NOT NULL,
	"visit_to_close_pct" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_economics_brand_id_fkey'
	) THEN
		ALTER TABLE "brand_sales_economics"
			ADD CONSTRAINT "brand_sales_economics_brand_id_fkey"
			FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
