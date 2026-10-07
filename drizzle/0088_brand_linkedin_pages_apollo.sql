-- The brand's own LinkedIn page: Apollo's company record (by the brand's domain)
-- is asked between the free reads of its site and the paid scrape. Additive
-- columns only.
--
-- apollo_asked_at NULL = Apollo was never asked for this row: a not_found stored
-- under the older order (site reads only) is decided again on the next discover.
-- apollo_outcome: linkedin_page | no_company | no_linkedin_url | other_domain |
-- not_company_page. apollo_linkedin_url: Apollo's linkedin_url verbatim.
-- none_found_reason: why a not_found row is not_found, written with the decision.
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "apollo_asked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "apollo_outcome" text;
--> statement-breakpoint
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "apollo_linkedin_url" text;
--> statement-breakpoint
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "none_found_reason" text;
