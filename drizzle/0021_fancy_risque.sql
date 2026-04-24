CREATE TABLE "brand_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_org_id" uuid NOT NULL,
	"target_org_id" uuid NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"service_results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_brand_transfers_brand_id" ON "brand_transfers" USING btree ("brand_id" uuid_ops);