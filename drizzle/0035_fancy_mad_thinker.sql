CREATE TABLE "brand_click_destination" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"click_destination_url" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_click_destination" ADD CONSTRAINT "brand_click_destination_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;