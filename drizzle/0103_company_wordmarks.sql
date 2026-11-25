-- BRANDMARK-WALL-1125: a company's wide wordmark, looked up ONCE per company at
-- logo.dev (v2 brandmark, 3 credits) and hosted by us. Identity grain (PK
-- brand_id), like brand_colors. found / none / unavailable are answers.
CREATE TABLE IF NOT EXISTS "company_wordmarks" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"etag" text,
	"light_url" text,
	"dark_url" text,
	"source" jsonb,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "company_wordmarks_status_check" CHECK ("status" IN ('pending','found','none','unavailable'))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_wordmarks_brand_id_fkey') THEN
		ALTER TABLE "company_wordmarks" ADD CONSTRAINT "company_wordmarks_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
-- The call ledger says which logo.dev endpoint each call hit: NULL / 'brand' =
-- the colours lookup, 'brandmark' = the wordmark lookup. Each cadence counts
-- only its own route against its own monthly budget.
ALTER TABLE "logo_dev_brand_calls" ADD COLUMN IF NOT EXISTS "route" text;
