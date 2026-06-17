ALTER TABLE "brand_sales_economics" ALTER COLUMN "reply_to_meeting_pct" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_meeting_pct" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "meeting_to_close_pct" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_signup_pct" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_signup_pct" SET DEFAULT 25;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "signup_to_paid_client_pct" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "signup_to_paid_client_pct" SET DEFAULT 20;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_close_pct" SET DATA TYPE numeric;