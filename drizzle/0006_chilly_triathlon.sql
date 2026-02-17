ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "leadership" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "funding" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "awards_and_recognition" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "revenue_milestones" jsonb;