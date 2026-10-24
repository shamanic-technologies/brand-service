-- COMPETITOR-SITE-IS-THE-COMPANY-1024: a competitor's site is served only once
-- Jev judged it to be THAT company's own. `domain` NULL = none confirmed.
ALTER TABLE "brand_competitors" ALTER COLUMN "domain" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_competitors" ADD COLUMN IF NOT EXISTS "proposed_domain" text;--> statement-breakpoint
ALTER TABLE "brand_competitors" ADD COLUMN IF NOT EXISTS "website_confidence" real;--> statement-breakpoint
ALTER TABLE "brand_competitors" ADD COLUMN IF NOT EXISTS "website_checked_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_competitors_linkedin_needs_site') THEN
    ALTER TABLE "brand_competitors" ADD CONSTRAINT "brand_competitors_linkedin_needs_site" CHECK (domain IS NOT NULL OR linkedin_url IS NULL);
  END IF;
END $$;
