CREATE TABLE IF NOT EXISTS "brand_share_tokens" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_share_tokens_brand_id_fkey') THEN
		ALTER TABLE "brand_share_tokens" ADD CONSTRAINT "brand_share_tokens_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_share_tokens_token_key" ON "brand_share_tokens" USING btree ("token");
