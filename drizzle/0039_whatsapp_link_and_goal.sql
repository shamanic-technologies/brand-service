CREATE TABLE IF NOT EXISTS "brand_whatsapp_links" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"whatsapp_link" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_whatsapp_links_brand_id_fkey') THEN
		ALTER TABLE "brand_whatsapp_links" ADD CONSTRAINT "brand_whatsapp_links_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_current_goal_check";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_current_goal_check" CHECK ("brands"."current_goal" IN ('signup', 'meetingBooked', 'purchase', 'websiteVisit', 'positiveReply', 'whatsappConversation'));
