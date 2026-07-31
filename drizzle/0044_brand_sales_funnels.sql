CREATE TABLE IF NOT EXISTS "brand_sales_funnels" (
	"brand_id" uuid NOT NULL,
	"funnel_key" text NOT NULL,
	"lifetime_revenue_usd" integer,
	"reply_to_meeting_pct" numeric(7, 4),
	"visit_to_meeting_pct" numeric(7, 4),
	"meeting_booked_to_attended_pct" numeric(7, 4),
	"meeting_to_close_pct" numeric(7, 4),
	"visit_to_signup_pct" numeric(7, 4),
	"signup_to_paid_client_pct" numeric(7, 4),
	"visit_to_form_submission_pct" numeric(7, 4),
	"form_submission_to_paid_client_pct" numeric(7, 4),
	"destination_url" text,
	"booking_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_sales_funnels_brand_id_funnel_key_pk" PRIMARY KEY("brand_id","funnel_key"),
	CONSTRAINT "brand_sales_funnels_funnel_key_check" CHECK ("brand_sales_funnels"."funnel_key" IN ('reply_meeting', 'visit_meeting', 'visit_signup', 'visit_form'))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_sales_funnels_brand_id_fkey') THEN
		ALTER TABLE "brand_sales_funnels" ADD CONSTRAINT "brand_sales_funnels_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;