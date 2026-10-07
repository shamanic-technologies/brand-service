-- The brand's own LinkedIn page can be SET by a person (any member of an org
-- that owns the brand): linkedin_source 'user'. A set page wins over every
-- automatic source and no later discover overwrites it. Additive columns only.
--
-- set_by_user_id / set_by_org_id: who set it (internal client-service UUIDs;
-- user NULL when the caller sent none). set_at: when.
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "set_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "set_by_org_id" uuid;
--> statement-breakpoint
ALTER TABLE "brand_linkedin_pages" ADD COLUMN IF NOT EXISTS "set_at" timestamp with time zone;
