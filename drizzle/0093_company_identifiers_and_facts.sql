-- A COMPANY A LEAD WORKS AT LIVES IN BRAND-SERVICE (owner 2026-10-13).
-- A prospect's company is a brand row like any other (same domain = same brand
-- id), nobody's client. `company_identifiers` maps the identities that are safe
-- without a domain (LinkedIn company page, Apollo organization id) onto one
-- brand; `company_facts` holds what is known about it, one row per fact, with
-- its source and observation time. Additive, idempotent.
CREATE TABLE IF NOT EXISTS "company_identifiers" (
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_identifiers_pkey" PRIMARY KEY("kind","value"),
	CONSTRAINT "company_identifiers_kind_check" CHECK (kind IN ('linkedin_company', 'apollo_organization'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_identifiers_brand_id_idx" ON "company_identifiers" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_identifiers_brand_id_fkey') THEN
    ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_facts" (
	"brand_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_facts_pkey" PRIMARY KEY("brand_id","fact_key")
);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_facts_brand_id_fkey') THEN
    ALTER TABLE "company_facts" ADD CONSTRAINT "company_facts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
