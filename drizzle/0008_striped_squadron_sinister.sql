ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "urgency" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "scarcity" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "risk_reversal" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "price_anchoring" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD COLUMN IF NOT EXISTS "value_stacking" jsonb;
