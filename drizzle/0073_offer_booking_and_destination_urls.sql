-- WAVE C3 prerequisite (distribute.you#4413): the booking link and the click
-- destination get a home per OFFER, so the last funnel read
-- (`GET /internal/offers/:offerId/sales-funnels`) and its frozen tables can be
-- dropped without losing them. Until now `brand_sales_funnels` was the only
-- place in the fleet that held an offer's booking link (the AI meeting-booking
-- DAG reads it) and its click destination.
--
-- Carry-over: an offer's value is copied only when its funnel rows (active or not)
-- agree on ONE distinct value (prod 2026-09-26: every offer carrying either
-- field carries exactly one — 3 booking links, 13 destinations). An offer whose
-- rows disagree gets nothing rather than an arbitrary pick. Additive; nothing is
-- removed here.

ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "booking_url" text;--> statement-breakpoint
ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "destination_url" text;--> statement-breakpoint
UPDATE "brand_offers" o SET "booking_url" = f.v
  FROM (
    SELECT "offer_id", min("booking_url") AS v FROM "brand_sales_funnels"
     WHERE "offer_id" IS NOT NULL AND "booking_url" IS NOT NULL
     GROUP BY "offer_id" HAVING count(DISTINCT "booking_url") = 1
  ) f
 WHERE o."id" = f."offer_id" AND o."booking_url" IS NULL;--> statement-breakpoint
UPDATE "brand_offers" o SET "destination_url" = f.v
  FROM (
    SELECT "offer_id", min("destination_url") AS v FROM "brand_sales_funnels"
     WHERE "offer_id" IS NOT NULL AND "destination_url" IS NOT NULL
     GROUP BY "offer_id" HAVING count(DISTINCT "destination_url") = 1
  ) f
 WHERE o."id" = f."offer_id" AND o."destination_url" IS NULL;
