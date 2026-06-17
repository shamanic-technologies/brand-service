ALTER TABLE "brands" ADD COLUMN "current_goal" text DEFAULT 'purchase' NOT NULL;--> statement-breakpoint
UPDATE "brands"
SET "current_goal" = CASE "brand_sales_economics"."optimization_goal"
	WHEN 'signups' THEN 'signup'
	WHEN 'booked_meetings' THEN 'meetingBooked'
	ELSE 'purchase'
END
FROM "brand_sales_economics"
WHERE "brand_sales_economics"."brand_id" = "brands"."id";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_current_goal_check" CHECK ("brands"."current_goal" IN ('signup', 'meetingBooked', 'purchase'));
