ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_form_submission_pct" SET DEFAULT 25;--> statement-breakpoint
UPDATE "brand_sales_economics" SET "visit_to_form_submission_pct" = 25 WHERE "visit_to_form_submission_pct" IS NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "visit_to_form_submission_pct" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "form_submission_to_paid_client_pct" SET DEFAULT 20;--> statement-breakpoint
UPDATE "brand_sales_economics" SET "form_submission_to_paid_client_pct" = 20 WHERE "form_submission_to_paid_client_pct" IS NULL;--> statement-breakpoint
ALTER TABLE "brand_sales_economics" ALTER COLUMN "form_submission_to_paid_client_pct" SET NOT NULL;
