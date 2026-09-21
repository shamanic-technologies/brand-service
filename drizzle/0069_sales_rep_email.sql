-- SALES REP EMAIL (2026-09-21) — the row stops being "a phone number" and
-- becomes "the one person to reach when a sales interest lands on this brand",
-- with two facts about them.
--
-- WHY: two consumers need the rep's address and nowhere in the fleet held one.
-- The service that forwards a positive reply's whole thread to the agency inbox
-- must copy the rep at the moment the reply lands, just before their phone
-- rings; and the AI meeting-booking channel, which replies one-to-one inside a
-- prospect's thread, must copy them on that too. That second channel has no use
-- for a phone at all, which is why an email-only rep is a legitimate state.
--
-- ON THE BRAND, not the campaign: a campaign is (offer x funnel x channel), so
-- a brand running four channels on one offer would retype one person's address
-- four times and drift from the first edit, and a brand with no campaign yet
-- could state nothing. The rep answers for the brand. NOT inferred from the org
-- owner's account email either — that is a guess about who the rep is, and
-- being wrong means mailing a client's prospect conversation to the wrong
-- person.
--
-- BOTH columns nullable + a CHECK that at least one is set. `phone` loses its
-- NOT NULL because an email-only rep must be storable; the CHECK replaces what
-- that NOT NULL was really saying (a row carrying nothing is not a rep —
-- clearing the rep DELETES the row, which is what keeps "unset" one state).
--
-- ⚠️ THE PRODUCT RULE ("a phone requires an email") IS DELIBERATELY NOT IN THIS
-- MIGRATION. Three production rows carry a phone and no email; we were never
-- told those reps' addresses and nothing may invent one, so they must keep
-- working exactly as they do today — rung, never copied. A CHECK would make
-- them unwritable and recast a true record of a fact we do not have as a
-- constraint violation. The rule is enforced at the WRITE, where it can refuse
-- with a sentence a person can act on.
--
-- The table NAME stays `brand_sales_rep_phones`: it is addressed by literal
-- string in brandMergeService and carried by every drizzle snapshot, so a
-- rename costs a migration that can go wrong and buys a reader nothing.
--
-- Additive + backward-compatible: no existing row is rewritten, and the
-- phone-only write path keeps working unchanged.
ALTER TABLE "brand_sales_rep_phones" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "brand_sales_rep_phones" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_sales_rep_phones" ADD CONSTRAINT "sales_rep_has_a_fact" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;
