ALTER TABLE "orgs" RENAME COLUMN "clerk_org_id" TO "org_id";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "clerk_user_id" TO "user_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_orgs_app_clerk_id";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orgs_app_org_id" ON "orgs" USING btree ("app_id" text_ops ASC NULLS LAST,"org_id" text_ops ASC NULLS LAST);--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_clerk_user_id_key";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_user_id_key" UNIQUE("user_id");
