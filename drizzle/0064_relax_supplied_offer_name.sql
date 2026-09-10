-- A supplied offer name is a CEILING, not a word count.
--
-- The 2-word / 20-character rule was written for a name we GENERATE and was
-- being applied to names customers type. A real customer was refused
-- `Psylium-Swiss-Bio-Drogerien` — one word to them, twenty-seven characters to
-- us. The word check goes entirely and the ceiling moves to 60.
--
-- The tighter rule survives for a name this service mints for itself, in the
-- write path (`generatedOfferNameProblem`), which is the only layer that can
-- tell a generated name from a supplied one. The database sees only a stored
-- string, so it enforces the ceiling both paths share.
--
-- Widening a CHECK cannot fail on existing rows: every stored name already
-- satisfied the tighter rule.

ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_words_check";

ALTER TABLE "brand_offers" DROP CONSTRAINT IF EXISTS "brand_offers_name_length_check";

ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);
