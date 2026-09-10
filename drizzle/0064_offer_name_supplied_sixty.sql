-- An offer name a CALLER SUPPLIED is theirs to choose: up to 60 characters, and
-- no word rule at all. A real customer was refused "Psylium-Swiss-Bio-Drogerien"
-- — one word to them, four to a word counter — by limits written for a name this
-- service GENERATES. Those limits (2 words, 20 characters) stay, in code, on the
-- derived path only: the implicit offer a legacy brand-scoped write creates and
-- the name the one-time migration mints. Nothing derived writes around the
-- service, so the column only needs to hold the outer bound every surface can
-- render.
--
-- Widening a CHECK and dropping one can never fail on existing rows: every name
-- stored under the old pair satisfies the new one.
ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_words_check";

ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_length_check";

ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);
