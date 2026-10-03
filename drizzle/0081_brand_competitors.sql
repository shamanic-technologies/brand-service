-- A brand's DIRECT competitors, found by us (never typed by a client), and each
-- competitor's LinkedIn company page when its own website links one. Additive:
-- two new tables, nothing existing reads or writes them.
--
-- A brand is a GLOBAL identity, so its competitors are a fact about the brand,
-- not about an org: keyed on brand_id alone.
--
-- No discovery row = never computed. A discovery row with zero competitor rows
-- = computed, nothing found. Two different answers, by construction.
CREATE TABLE IF NOT EXISTS "brand_competitor_discoveries" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"requested_by_org_id" uuid,
	"run_id" text,
	"proposed_count" integer NOT NULL,
	CONSTRAINT "brand_competitor_discoveries_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"linkedin_url" text,
	"linkedin_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade,
	CONSTRAINT "brand_competitors_linkedin_has_source" CHECK (("linkedin_url" IS NULL) = ("linkedin_source" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_competitors_brand_domain_key" ON "brand_competitors" USING btree ("brand_id","domain");
