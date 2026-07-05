ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_current_goal_check";--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ADD COLUMN IF NOT EXISTS "visit_to_paid_client_pct" numeric(7, 4) DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ADD COLUMN IF NOT EXISTS "reply_to_paid_client_pct" numeric(7, 4) DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_current_goal_check" CHECK ("brands"."current_goal" IN ('signup', 'meetingBooked', 'purchase', 'websiteVisit', 'positiveReply'));
