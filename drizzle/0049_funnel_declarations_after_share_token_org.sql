-- Re-create `brand_sales_funnel_declarations` under a stamp production has not passed.
--
-- 0046 created this table, but production never ran it. The v0.60.1 hotfix authored
-- 0048 directly on `main` and production applied it at 1785509661079, while 0046 sat
-- unpromoted on `staging` stamped 1785489221879 — earlier. Drizzle's migrator applies
-- only migrations stamped ABOVE the last one it recorded, so promoting staging inserted
-- 0046 behind a bar production had already cleared, and it can never run there.
--
-- The result was not a pending migration but a permanent hole: the table was absent in
-- production while every environment's journal claimed it existed. Both sales-funnel
-- reads 500'd, and so did `rewriteBrandReferences` — the merge primitive behind domain
-- takeover, which is a customer write path.
--
-- This carries 0046's statements verbatim under a stamp above 0048. Both are idempotent,
-- so on staging (where 0046 did run) this is a no-op, and re-running it is safe anywhere.
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
