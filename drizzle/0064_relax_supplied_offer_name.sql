-- A name a CALLER SUPPLIES is accepted up to 60 characters, with no word rule.
--
-- The 2-word / 20-character pair was written for a name this service GENERATES
-- and it stays there, in code (`derivedOfferNameProblem`). It was never right
-- for a name a person types: a customer naming their own proposition
-- ("Psylium-Swiss-Bio-Drogerien") reads it as one word where a counter reads
-- four, and the refusal read as the product being broken.
--
-- Storage is relaxed in the same step as the write path so the two layers agree:
-- a name the route accepts must not then die on a constraint. The word check is
-- DROPPED outright rather than widened — nothing writes a derived name directly
-- into this table, so the rule has no business in storage. The length check is
-- only ever WIDENED (20 -> 60), so no existing row can violate it.
ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_words_check";--> statement-breakpoint
ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_length_check";--> statement-breakpoint
ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_name_length_check" CHECK (char_length(btrim("brand_offers"."name")) BETWEEN 1 AND 60);
