ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "organizations_clerk_organization_id_key";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_organizations_clerk_organization_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organizations_clerk_organization_id" ON "brands" USING btree ("clerk_org_id" text_ops) WHERE (clerk_org_id IS NOT NULL);