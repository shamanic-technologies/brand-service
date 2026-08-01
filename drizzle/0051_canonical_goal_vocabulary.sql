-- The fleet speaks ONE goal vocabulary, and the stored values move with the wire.
--
-- Two tokens are renamed and one is promoted:
--   purchase        -> websitePurchase   (the display name already renamed; `purchase` was the ambiguous one)
--   signup + form   -> formSubmission    (form submission stops collapsing onto the signup runtime goal)
-- and `brand_sales_economics.optimization_goal` — a pure mirror of the goal now
-- that no wire value is a sub-type of another — is respelled into the same
-- vocabulary so the column and the wire agree.
--
-- The goal lives on `org_brands.current_goal` (per (org, brand), migration 0050),
-- and the economics row is keyed the same way — so the form-submission promotion
-- matches on the ORG's own economics row, never another org's.
--
-- Idempotent: re-running finds no legacy spelling left and changes nothing.
--
-- DELIBERATELY NOT REPAIRED: a set of brands carry `current_goal = purchase`
-- while their economics row says `booked_meetings`. Which column is right is a
-- data question, not a naming one. They are respelled like everyone else
-- (-> websitePurchase / meetingBooked) and stay divergent.

ALTER TABLE "org_brands" DROP CONSTRAINT IF EXISTS "org_brands_current_goal_check";

-- Order matters: this reads the pre-migration `form_submissions` spelling.
UPDATE "org_brands" o
SET "current_goal" = 'formSubmission'
WHERE o."current_goal" = 'signup'
  AND EXISTS (
    SELECT 1 FROM "brand_sales_economics" e
    WHERE e."org_id" = o."org_id"
      AND e."brand_id" = o."brand_id"
      AND e."optimization_goal" = 'form_submissions'
  );

UPDATE "org_brands" SET "current_goal" = 'websitePurchase' WHERE "current_goal" = 'purchase';

ALTER TABLE "org_brands" ALTER COLUMN "current_goal" SET DEFAULT 'websitePurchase';

ALTER TABLE "org_brands" ADD CONSTRAINT "org_brands_current_goal_check"
  CHECK ("current_goal" IN ('signup', 'meetingBooked', 'websitePurchase', 'combinedSales', 'websiteVisit', 'positiveReply', 'formSubmission', 'whatsappConversation'));

UPDATE "brand_sales_economics" SET "optimization_goal" = CASE "optimization_goal"
  WHEN 'signups' THEN 'signup'
  WHEN 'booked_meetings' THEN 'meetingBooked'
  WHEN 'sales_meetings' THEN 'meetingBooked'
  WHEN 'sales' THEN 'websitePurchase'
  WHEN 'website_purchase' THEN 'websitePurchase'
  WHEN 'purchase' THEN 'websitePurchase'
  WHEN 'combined_sales' THEN 'combinedSales'
  WHEN 'website_visits' THEN 'websiteVisit'
  WHEN 'positive_replies' THEN 'positiveReply'
  WHEN 'form_submissions' THEN 'formSubmission'
  WHEN 'whatsapp_conversations' THEN 'whatsappConversation'
  ELSE "optimization_goal"
END;

ALTER TABLE "brand_sales_economics" ALTER COLUMN "optimization_goal" SET DEFAULT 'websitePurchase';
