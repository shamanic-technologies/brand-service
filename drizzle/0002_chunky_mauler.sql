CREATE TABLE "brand_icp_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"target_titles" jsonb,
	"target_industries" jsonb,
	"target_locations" jsonb,
	"extraction_model" text,
	"extraction_input_tokens" integer,
	"extraction_output_tokens" integer,
	"extraction_cost_usd" numeric,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_icp_suggestions_brand_id_key" UNIQUE("brand_id")
);
--> statement-breakpoint
ALTER TABLE "brand_icp_suggestions" ADD CONSTRAINT "brand_icp_suggestions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_icp_suggestions_expires" ON "brand_icp_suggestions" USING btree ("expires_at" timestamptz_ops);
