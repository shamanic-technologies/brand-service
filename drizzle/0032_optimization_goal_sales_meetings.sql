UPDATE "brand_sales_economics"
SET "optimization_goal" = 'sales_meetings'
WHERE "optimization_goal" IN ('sales', 'booked_meetings');--> statement-breakpoint
ALTER TABLE "brand_sales_economics"
ALTER COLUMN "optimization_goal" SET DEFAULT 'sales_meetings';
