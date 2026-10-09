-- AN OFFER'S SALES-PATH LEGS CARRY THEIR CHANNEL (owner 2026-10-09).
-- `leg_keys` held BARE keys, so the day a customer ticks "Website visit" for
-- Google Ads it would have been stored as cold email's leg. `legs` stores each
-- leg as `<legKey>@<featureSlug>` (the bare key for a non-entry leg with no
-- channel); `leg_keys` stays written as its bare projection for every reader of
-- the old shape.
-- Every stored entry leg (`start_to_*`, `lead_found_to_*`) is cold email's: the
-- Sales path surface offers an entry leg only for the channels we run, and cold
-- email is the only one of those performing one (checked in prod 2026-10-09:
-- 28 rows, every entry leg `lead_found_to_conversation` / `lead_found_to_website_visit`).
-- Nullable on purpose: the pre-0092 container may write a row during the deploy
-- swap, and the service reads a NULL `legs` with this same rule.
-- Idempotent: only rows with `legs IS NULL` are filled.
ALTER TABLE "brand_offer_sales_paths" ADD COLUMN IF NOT EXISTS "legs" text[];--> statement-breakpoint
UPDATE brand_offer_sales_paths p
SET legs = COALESCE((
  SELECT array_agg(
           CASE WHEN u.k LIKE 'start\_to\_%' OR u.k LIKE 'lead\_found\_to\_%'
                THEN u.k || '@sales-cold-email-outreach'
                ELSE u.k
           END
           ORDER BY u.ord)
  FROM unnest(p.leg_keys) WITH ORDINALITY AS u(k, ord)
), ARRAY[]::text[])
WHERE p.legs IS NULL;
