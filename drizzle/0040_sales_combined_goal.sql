-- Widen the current_goal CHECK to admit the NEW combined "Sales" goal
-- ('combinedSales'). Additive only: existing purchase-brands keep current_goal
-- 'purchase' (website-purchase) untouched, so their semantics are preserved and
-- no stored row is reinterpreted as the new combined goal.
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_current_goal_check";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_current_goal_check" CHECK ("brands"."current_goal" IN ('signup', 'meetingBooked', 'purchase', 'websiteVisit', 'positiveReply', 'whatsappConversation', 'combinedSales'));