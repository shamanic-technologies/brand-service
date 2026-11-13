-- SCRIPT-VALUE-RATING-1113: which draft a stored field value came from, so the
-- surface where a client edits what we drafted can name the Unit it reports.
-- Additive, every column NULL / false on existing rows (nobody recorded it).
ALTER TABLE "brand_extracted_fields" ADD COLUMN IF NOT EXISTS "draft_outcome_key" text;--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" ADD COLUMN IF NOT EXISTS "draft_subject_id" text;--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" ADD COLUMN IF NOT EXISTS "draft_run_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_extracted_fields" ADD COLUMN IF NOT EXISTS "draft_unit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "from_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "draft_outcome_key" text;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "draft_subject_id" text;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "draft_run_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD COLUMN IF NOT EXISTS "draft_unit_at" timestamp with time zone;
