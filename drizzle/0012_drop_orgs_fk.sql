-- Drop FK constraints referencing the legacy `orgs` table.
-- The code uses x-org-id (client-service UUID) directly as brands.org_id
-- without orgs table indirection, making these FKs dead constraints that
-- block new orgs from creating brands/sales-profiles.
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_org_id_fkey";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_org_id_fkey";
