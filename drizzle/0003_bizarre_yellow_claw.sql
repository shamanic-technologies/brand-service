DROP TABLE "tasks" CASCADE;--> statement-breakpoint
DROP TABLE "tasks_runs" CASCADE;--> statement-breakpoint
DROP TABLE "tasks_runs_costs" CASCADE;--> statement-breakpoint
-- Backfill brands.name from sales profiles where brands.name is NULL
UPDATE brands b
SET name = sp.company_name, updated_at = NOW()
FROM brand_sales_profiles sp
WHERE sp.brand_id = b.id
  AND b.name IS NULL
  AND sp.company_name IS NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" DROP COLUMN "company_name";