-- OFFER ANSWERS (2026-09-21) — the answers a customer states to the questions a
-- buyer asks about one offer, so an AI responder can answer "how much are they?"
-- instead of writing around it and asking for a call.
--
-- Question-and-answer pairs rather than a named set of facts: the named-set
-- model already exists one table over (`brand_user_fields`, eight keys held by a
-- CHECK) and adding a ninth key cost a code change plus migration 0067, during
-- which every new signup's write 400'd. Buyer questions are unbounded and
-- trade-specific, so a closed set leaves a hole only a deploy can fill.
--
-- On the OFFER, not the brand: a price is a property of a proposition. A brand
-- selling a $200 plan and a $20k contract answers "how much" differently for
-- each, which is the same reason funnels, rates and the value levers already
-- hang off the offer.
--
-- Purely additive: a new table, no existing column or constraint touched.
-- `offer_id` is NOT NULL because this table is born after offers exist, so no
-- un-migrated row can be created.
CREATE TABLE IF NOT EXISTS "brand_offer_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_offer_answers_question_not_blank" CHECK (btrim("question") <> ''),
	CONSTRAINT "brand_offer_answers_answer_not_blank" CHECK (btrim("answer") <> ''),
	CONSTRAINT "brand_offer_answers_position_non_negative" CHECK ("position" >= 0)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_offer_answers" ADD CONSTRAINT "brand_offer_answers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_offer_answers" ADD CONSTRAINT "brand_offer_answers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offer_answers_offer_id_position_key" ON "brand_offer_answers" USING btree ("offer_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_offer_answers_offer_id_idx" ON "brand_offer_answers" USING btree ("offer_id");
