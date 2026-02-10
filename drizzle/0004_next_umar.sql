ALTER TABLE "brands" DROP CONSTRAINT "organizations_clerk_organization_id_key";--> statement-breakpoint
DROP INDEX "idx_organizations_clerk_organization_id";--> statement-breakpoint
CREATE INDEX "idx_organizations_clerk_organization_id" ON "brands" USING btree ("clerk_org_id" text_ops) WHERE (clerk_org_id IS NOT NULL);