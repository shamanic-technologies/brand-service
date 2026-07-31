CREATE TABLE "brand_share_links" (
	"org_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_share_links_org_id_brand_id_pk" PRIMARY KEY("org_id","brand_id")
);
--> statement-breakpoint
ALTER TABLE "brand_share_links" ADD CONSTRAINT "brand_share_links_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_share_links_token_key" ON "brand_share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "brand_share_links_brand_id_idx" ON "brand_share_links" USING btree ("brand_id");