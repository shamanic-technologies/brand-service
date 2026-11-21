-- BRAND-PROOF-LOGOS-1121: a company's notoriety (Jev score, judged once,
-- cross-org) and the two proof Units a script stores per brand: client past
-- employers and press features. Additive: three new tables.
CREATE TABLE IF NOT EXISTS "company_notoriety" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" integer,
	"confidence" real,
	"judge_score" real,
	"judge_levels" integer,
	"probabilities" jsonb,
	"monthly_traffic" bigint,
	"traffic_measured_at" timestamp with time zone,
	"traffic_source" text,
	"judged_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"requester_org_id" uuid NOT NULL,
	"requester_user_id" text,
	"requester_run_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_notoriety_status_check" CHECK (status IN ('pending', 'judged', 'failed')),
	CONSTRAINT "company_notoriety_score_check" CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_proof_employers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"company_brand_id" uuid NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_key" text,
	"unit_run_id" text,
	"unit_declared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_proof_press_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_brand_id" uuid,
	"outlet_name" text,
	"article_url" text NOT NULL,
	"title" text,
	"published_at" date,
	"outcome_key" text,
	"unit_run_id" text,
	"unit_declared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_notoriety_brand_id_fkey') THEN
	ALTER TABLE "company_notoriety" ADD CONSTRAINT "company_notoriety_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_proof_employers_brand_id_fkey') THEN
	ALTER TABLE "brand_proof_employers" ADD CONSTRAINT "brand_proof_employers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_proof_employers_company_brand_id_fkey') THEN
	ALTER TABLE "brand_proof_employers" ADD CONSTRAINT "brand_proof_employers_company_brand_id_fkey" FOREIGN KEY ("company_brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_proof_press_features_brand_id_fkey') THEN
	ALTER TABLE "brand_proof_press_features" ADD CONSTRAINT "brand_proof_press_features_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_proof_press_features_outlet_brand_id_fkey') THEN
	ALTER TABLE "brand_proof_press_features" ADD CONSTRAINT "brand_proof_press_features_outlet_brand_id_fkey" FOREIGN KEY ("outlet_brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_notoriety_status_idx" ON "company_notoriety" USING btree ("status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_proof_employers_org_brand_company_key" ON "brand_proof_employers" USING btree ("org_id" uuid_ops,"brand_id" uuid_ops,"company_brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_proof_employers_brand_idx" ON "brand_proof_employers" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_proof_press_features_org_brand_url_key" ON "brand_proof_press_features" USING btree ("org_id" uuid_ops,"brand_id" uuid_ops,"article_url" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_proof_press_features_brand_idx" ON "brand_proof_press_features" USING btree ("brand_id" uuid_ops);
