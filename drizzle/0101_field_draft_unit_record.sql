-- ENGINE-GET-ASK-1123: the durable, append-only record of a suggest draft's
-- Unit (« Offer fields drafted » / « Brand fields drafted »). Until now its only
-- trace was the draft columns on brand_extracted_fields (a 3-day cache whose
-- expired rows a daily cron deletes, no org column) and on brand_user_fields,
-- so an old Unit could not be read back. Additive: one new table, then a
-- backfill from the rows that still name a declared Unit.
CREATE TABLE IF NOT EXISTS "field_draft_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"brand_id" uuid NOT NULL,
	"offer_id" uuid,
	"outcome_key" text NOT NULL,
	"subject_service" text DEFAULT 'brand-service' NOT NULL,
	"subject_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"unit_at" timestamp with time zone NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_draft_units_brand_id_fkey') THEN
	ALTER TABLE "field_draft_units" ADD CONSTRAINT "field_draft_units_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "field_draft_units_run_outcome_subject_key" ON "field_draft_units" USING btree ("run_id","outcome_key","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_draft_units_org_outcome_unit_at_idx" ON "field_draft_units" USING btree ("org_id","outcome_key","unit_at" DESC);--> statement-breakpoint
-- Backfill (a): the drafts still in the cache. One Unit per (outcome, subject,
-- run, time, brand); its fields = every value that names it. The org: an offer
-- draft takes its offer's org; a brand draft takes the brand's org only when
-- exactly ONE org claims the brand (else NULL: never served, never guessed).
INSERT INTO "field_draft_units" ("org_id", "brand_id", "offer_id", "outcome_key", "subject_id", "run_id", "unit_at", "fields")
SELECT
	CASE
		WHEN g.outcome_key = 'offer_fields_drafted' THEN (SELECT o.org_id FROM brand_offers o WHERE o.id = g.offer_id)
		ELSE (SELECT (array_agg(ob.org_id))[1] FROM org_brands ob WHERE ob.brand_id = g.brand_id HAVING count(*) = 1)
	END,
	g.brand_id, g.offer_id, g.outcome_key, g.subject_id, g.run_id, g.unit_at, g.fields
FROM (
	SELECT
		f.brand_id,
		f.draft_outcome_key AS outcome_key,
		f.draft_subject_id AS subject_id,
		f.draft_run_id AS run_id,
		f.draft_unit_at AS unit_at,
		CASE
			WHEN f.draft_outcome_key = 'offer_fields_drafted'
				AND f.draft_subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN f.draft_subject_id::uuid
		END AS offer_id,
		jsonb_object_agg(f.field_key, COALESCE(f.field_value, 'null'::jsonb)) AS fields
	FROM brand_extracted_fields f
	WHERE f.draft_unit_at IS NOT NULL
		AND f.draft_run_id IS NOT NULL
		AND f.draft_subject_id IS NOT NULL
		AND f.draft_outcome_key IN ('offer_fields_drafted', 'brand_fields_drafted')
	GROUP BY f.brand_id, f.draft_outcome_key, f.draft_subject_id, f.draft_run_id, f.draft_unit_at
) g
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Backfill (b): the drafts the client saved unchanged (brand_user_fields keeps
-- them past the cache). The org is the row's own. A Unit (a) already wrote is
-- left as is.
INSERT INTO "field_draft_units" ("org_id", "brand_id", "offer_id", "outcome_key", "subject_id", "run_id", "unit_at", "fields")
SELECT g.org_id, g.brand_id, g.offer_id, g.outcome_key, g.subject_id, g.run_id, g.unit_at, g.fields
FROM (
	SELECT
		u.org_id,
		u.brand_id,
		u.draft_outcome_key AS outcome_key,
		u.draft_subject_id AS subject_id,
		u.draft_run_id AS run_id,
		u.draft_unit_at AS unit_at,
		CASE WHEN u.draft_outcome_key = 'offer_fields_drafted' THEN u.offer_id END AS offer_id,
		jsonb_object_agg(u.field_key, COALESCE(u.value, 'null'::jsonb)) AS fields
	FROM brand_user_fields u
	WHERE u.from_draft
		AND u.draft_unit_at IS NOT NULL
		AND u.draft_run_id IS NOT NULL
		AND u.draft_subject_id IS NOT NULL
		AND u.draft_outcome_key IN ('offer_fields_drafted', 'brand_fields_drafted')
	GROUP BY u.org_id, u.brand_id, u.draft_outcome_key, u.draft_subject_id, u.draft_run_id, u.draft_unit_at,
		CASE WHEN u.draft_outcome_key = 'offer_fields_drafted' THEN u.offer_id END
) g
ON CONFLICT DO NOTHING;
