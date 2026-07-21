CREATE TABLE IF NOT EXISTS "brand_user_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_user_fields_field_key_check" CHECK ("brand_user_fields"."field_key" IN ('services', 'dreamOutcome', 'perceivedLikelihood', 'socialProof', 'riskReversal', 'urgency', 'scarcity'))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_user_fields_brand_id_fkey') THEN
		ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_user_fields_brand_id_field_key_key" ON "brand_user_fields" USING btree ("brand_id","field_key");
