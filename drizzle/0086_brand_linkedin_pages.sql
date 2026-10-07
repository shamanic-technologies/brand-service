-- The brand's OWN LinkedIn company page, read off its own website. Additive: one
-- new table, nothing existing reads or writes it.
--
-- No row = never looked for. A row with linkedin_url NULL = looked for, none
-- found. Keyed on brand_id alone (a brand is a global identity).
CREATE TABLE IF NOT EXISTS "brand_linkedin_pages" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"linkedin_url" text,
	"linkedin_source" text,
	"pages_read" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"found_on_url" text,
	"requested_by_org_id" uuid,
	"run_id" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_linkedin_pages_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade,
	CONSTRAINT "brand_linkedin_pages_url_has_source" CHECK (("linkedin_url" IS NULL) = ("linkedin_source" IS NULL))
);
