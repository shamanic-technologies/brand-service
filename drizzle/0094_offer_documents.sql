-- OFFER DOCUMENTS (2026-10-14): the files a client owns about one offer (a
-- one-pager, a case study, a spec sheet, an FAQ) so an AI answering a
-- prospect can attach the one that helps, and read them for context.
--
-- On the OFFER, like its answers and its value levers: a brand selling two
-- propositions has a different spec sheet for each.
--
-- The bytes live in Postgres (`content` bytea, TOASTed out of line). One box,
-- one database, and the nightly per-database pg_dump already covers it: no
-- second store to back up, no orphaned file when a row is deleted, and the
-- org teardown / brand transfer that already walk this table carry the file
-- with its row. Capped at 5 MB per file by the write (an email attachment).
--
-- Purely additive: a new table, no existing column or constraint touched.
CREATE TABLE IF NOT EXISTS "brand_offer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"description" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" bytea NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_offer_documents_file_name_not_blank" CHECK (btrim("file_name") <> ''),
	CONSTRAINT "brand_offer_documents_description_not_blank" CHECK (btrim("description") <> ''),
	CONSTRAINT "brand_offer_documents_size_positive" CHECK ("size_bytes" > 0)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_offer_documents" ADD CONSTRAINT "brand_offer_documents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "brand_offer_documents" ADD CONSTRAINT "brand_offer_documents_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."brand_offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_offer_documents_offer_id_sha256_key" ON "brand_offer_documents" USING btree ("offer_id","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_offer_documents_org_id_idx" ON "brand_offer_documents" USING btree ("org_id");
