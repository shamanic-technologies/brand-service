-- The OFFER — the level between a brand and a campaign.
--
-- A brand is an IDENTITY (a name, a domain, a logo). An offer is a PROPOSITION:
-- the value it promises (the 7 Hormozi user-fields) and the sales funnels it is
-- sold through, with their conversion rates, lifetime revenue and destinations.
-- All of that hung off the BRAND, which forced a brand selling a $200 self-serve
-- plan and a $20k contract to describe both as one thing. This migration creates
-- the table and RE-SCOPES the two tables that carry a value proposition onto it.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO: create the offers.
--
-- Every brand that already sells something gets exactly ONE offer carrying all
-- of it, and that offer's NAME is generated from what the brand actually sells —
-- an LLM call, and therefore a script (`scripts/backfill-brand-offers.ts`),
-- never a line of DDL. So `offer_id` lands NULLABLE here and is filled by that
-- script. A row still holding NULL is a row the migration has not reached, which
-- is exactly what makes the script idempotent: a second run finds no candidates.
--
-- The write path treats `offer_id` as NOT NULL from now on. A brand-scoped write
-- against a brand with no offer creates its first one; against a brand with
-- SEVERAL it is refused 409 rather than guessing which the caller meant.

CREATE TABLE IF NOT EXISTS "brand_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  -- At most 2 words, at most 20 characters. Owner-fixed: this is the only word
  -- anyone reads for the offer, and a longer one truncates differently on every
  -- surface that renders it. Enforced here as well as in the write path so a
  -- script writing around the service cannot create a name no surface can show.
  "name" text NOT NULL,
  -- Provenance for the one-time migration. Set on every offer that script
  -- creates, NULL on every offer a user or a caller creates directly.
  "migrated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brand_offers_name_length_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 20),
  CONSTRAINT "brand_offers_name_words_check"
    CHECK (array_length(regexp_split_to_array(btrim("name"), '\s+'), 1) <= 2)
);--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_offers_brand_id_fkey') THEN
    ALTER TABLE "brand_offers" ADD CONSTRAINT "brand_offers_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

-- Unique WITHIN the (org, brand) pair. Org-scoped like every other config table
-- here: `brands` is the global silver identity several orgs legitimately share.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offers_org_id_brand_id_name_key"
  ON "brand_offers" USING btree ("org_id", "brand_id", "name");--> statement-breakpoint

-- ── brand_sales_funnels: re-scoped onto the offer ───────────────────────────
-- The natural key was (org_id, brand_id, funnel_key) and was the primary key. It
-- stopped being unique the moment a brand could hold several offers: two offers
-- of one brand legitimately sell through the SAME chain at different rates and a
-- different lifetime revenue. The table gains a surrogate key, and the natural
-- key becomes (offer_id, funnel_key).

ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_funnels" ADD COLUMN IF NOT EXISTS "offer_id" uuid;--> statement-breakpoint

ALTER TABLE "brand_sales_funnels" DROP CONSTRAINT IF EXISTS "brand_sales_funnels_org_id_brand_id_funnel_key_pk";--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_pkey') THEN
    ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_pkey" PRIMARY KEY ("id");
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_offer_id_fkey') THEN
    ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_offer_id_fkey"
      FOREIGN KEY ("offer_id") REFERENCES "brand_offers"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "brand_sales_funnels_offer_id_funnel_key_key"
  ON "brand_sales_funnels" USING btree ("offer_id", "funnel_key");--> statement-breakpoint

-- The PREVIOUS natural key, kept for exactly the rows the backfill has not
-- reached. Postgres treats NULLs as distinct, so the index above constrains
-- nothing while `offer_id` is NULL; without this partial one, dropping the old
-- primary key would let a legacy write create a SECOND row for the same
-- (org, brand, funnel) and split a brand's economics across two rows nothing
-- would ever reconcile. It goes quiet on its own once every row is migrated.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_sales_funnels_unmigrated_key"
  ON "brand_sales_funnels" USING btree ("org_id", "brand_id", "funnel_key")
  WHERE "offer_id" IS NULL;--> statement-breakpoint

-- ── brand_user_fields: re-scoped onto the offer ─────────────────────────────
-- A dream outcome, a risk reversal and a scarcity are claims about ONE thing a
-- brand sells, not about the company.

ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "offer_id" uuid;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_user_fields_offer_id_fkey') THEN
    ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_offer_id_fkey"
      FOREIGN KEY ("offer_id") REFERENCES "brand_offers"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "brand_user_fields_org_id_brand_id_field_key_key";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "brand_user_fields_offer_id_field_key_key"
  ON "brand_user_fields" USING btree ("offer_id", "field_key");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "brand_user_fields_unmigrated_key"
  ON "brand_user_fields" USING btree ("org_id", "brand_id", "field_key")
  WHERE "offer_id" IS NULL;
