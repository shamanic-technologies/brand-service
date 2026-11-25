-- PROOF-LOGOS-MISSING-1125: a past employer known only by its LinkedIn page
-- gets its domain from the website that page states (treg, once per company).
-- Recorded here so a page is read once, whatever it answered.
ALTER TABLE "company_notoriety" ADD COLUMN IF NOT EXISTS "domain_lookup_at" timestamp with time zone;
ALTER TABLE "company_notoriety" ADD COLUMN IF NOT EXISTS "domain_lookup_outcome" text;
ALTER TABLE "company_notoriety" ADD COLUMN IF NOT EXISTS "domain_lookup_domain" text;
