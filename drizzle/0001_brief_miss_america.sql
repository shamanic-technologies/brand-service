-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."belonging_confidence_level_enum" AS ENUM('found_online', 'guessed', 'user_inputed');--> statement-breakpoint
CREATE TYPE "public"."organization_individual_status" AS ENUM('active', 'ended', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."organization_individual_thesis_status" AS ENUM('pending', 'validated', 'denied', 'generating');--> statement-breakpoint
CREATE TYPE "public"."organization_relation_status" AS ENUM('active', 'ended', 'hidden', 'not_related');--> statement-breakpoint
CREATE TYPE "public"."organization_relation_type" AS ENUM('subsidiary', 'holding', 'product', 'main_company', 'client', 'supplier', 'shareholder', 'other');--> statement-breakpoint
CREATE TYPE "public"."web_page_category_enum" AS ENUM('company_info', 'offerings', 'credibility', 'content', 'legal', 'other');--> statement-breakpoint
CREATE TABLE "pgmigrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"run_on" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_key" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"external_organization_id" text,
	"organization_linkedin_url" text,
	"domain" text,
	"status" text,
	"generating_started_at" timestamp with time zone,
	"location" text,
	"bio" text,
	"elevator_pitch" text,
	"mission" text,
	"story" text,
	"offerings" text,
	"problem_solution" text,
	"goals" text,
	"categories" text,
	"founded_date" date,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"social_media" jsonb,
	"logo_url" text,
	"clerk_org_id" varchar(255),
	"org_id" uuid,
	CONSTRAINT "organizations_external_organization_id_key" UNIQUE("external_organization_id"),
	CONSTRAINT "organizations_clerk_organization_id_key" UNIQUE("clerk_org_id"),
	CONSTRAINT "organizations_status_check" CHECK ((status IS NULL) OR (status = 'generating'::text))
);
--> statement-breakpoint
CREATE TABLE "individuals_pdl_enrichment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"individual_id" uuid NOT NULL,
	"organization_url" text,
	"raw_data" jsonb NOT NULL,
	"pdl_id" text,
	"full_name" text,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"sex" text,
	"birth_year" integer,
	"linkedin_url" text,
	"linkedin_username" text,
	"linkedin_id" text,
	"facebook_url" text,
	"twitter_url" text,
	"github_url" text,
	"job_title" text,
	"job_title_role" text,
	"job_title_sub_role" text,
	"job_title_class" text,
	"job_title_levels" text[],
	"job_company_name" text,
	"job_company_website" text,
	"job_company_size" text,
	"job_company_industry" text,
	"job_company_linkedin_url" text,
	"job_start_date" text,
	"job_last_verified" date,
	"location_name" text,
	"location_locality" text,
	"location_region" text,
	"location_country" text,
	"location_continent" text,
	"location_geo" text,
	"work_email_available" boolean,
	"personal_emails_available" boolean,
	"mobile_phone_available" boolean,
	"skills" text[],
	"experience" jsonb,
	"education" jsonb,
	"dataset_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interests" text[],
	"likelihood" integer,
	"countries" text[],
	"job_company_founded" integer,
	"job_company_location_country" text,
	"job_last_changed" date,
	"recommended_personal_email" text,
	CONSTRAINT "individuals_pdl_enrichment_individual_id_unique" UNIQUE("individual_id"),
	CONSTRAINT "individuals_pdl_enrichment_pdl_id_key" UNIQUE("pdl_id")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_type" text NOT NULL,
	"asset_url" text NOT NULL,
	"supabase_storage_id" uuid,
	"optimized_url" text,
	"caption" text,
	"alt_text" text,
	"is_shareable" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"brand_id" uuid,
	CONSTRAINT "media_assets_asset_url_unique" UNIQUE("asset_url"),
	CONSTRAINT "media_assets_asset_type_check" CHECK (asset_type = ANY (ARRAY['uploaded_file'::text, 'youtube'::text, 'spotify'::text, 'vimeo'::text, 'soundcloud'::text, 'other'::text]))
);
--> statement-breakpoint
CREATE TABLE "supabase_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supabase_url" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" bigint,
	"mime_type" text,
	"file_extension" text,
	"width" integer,
	"height" integer,
	"duration" numeric,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"md5_hash" text,
	CONSTRAINT "supabase_storage_supabase_url_key" UNIQUE("supabase_url")
);
--> statement-breakpoint
CREATE TABLE "individuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"linkedin_url" text,
	"personal_website_url" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "individuals_linkedin_url_key" UNIQUE("linkedin_url")
);
--> statement-breakpoint
CREATE TABLE "brand_linkedin_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"raw_data" jsonb NOT NULL,
	"post_type" text NOT NULL,
	"linkedin_post_id" text NOT NULL,
	"linkedin_url" text NOT NULL,
	"content" text,
	"content_attributes" jsonb,
	"author" jsonb,
	"author_name" text,
	"author_linkedin_url" text,
	"author_universal_name" text,
	"posted_at" timestamp with time zone,
	"posted_at_data" jsonb,
	"post_images" jsonb,
	"has_images" boolean DEFAULT false,
	"repost_id" text,
	"repost_data" jsonb,
	"is_repost" boolean DEFAULT false,
	"social_content" jsonb,
	"engagement" jsonb,
	"likes_count" integer DEFAULT 0,
	"comments_count" integer DEFAULT 0,
	"shares_count" integer DEFAULT 0,
	"impressions_count" integer DEFAULT 0,
	"reactions" jsonb,
	"comments" jsonb,
	"header" jsonb,
	"article" jsonb,
	"article_link" text,
	"article_title" text,
	"has_article" boolean DEFAULT false,
	"input" jsonb,
	"query" jsonb,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_avatar_url" text,
	"author_info" jsonb,
	"article_image_url" text,
	"article_description" text,
	CONSTRAINT "organizations_linkedin_posts_linkedin_post_id_key" UNIQUE("linkedin_post_id")
);
--> statement-breakpoint
CREATE TABLE "brand_sales_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"company_name" text,
	"value_proposition" text,
	"customer_pain_points" jsonb,
	"call_to_action" text,
	"social_proof" jsonb,
	"company_overview" text,
	"additional_context" text,
	"competitors" jsonb,
	"product_differentiators" jsonb,
	"target_audience" text,
	"key_features" jsonb,
	"extraction_model" text,
	"extraction_input_tokens" integer,
	"extraction_output_tokens" integer,
	"extraction_cost_usd" numeric,
	"source_scrape_ids" jsonb,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_sales_profiles_organization_id_key" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "scraped_url_firecrawl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean,
	"return_code" integer,
	"source_url" text,
	"url" text NOT NULL,
	"scrape_id" text,
	"content" text,
	"markdown" text,
	"html" text,
	"raw_html" text,
	"links" text[],
	"title" text,
	"description" text,
	"language" text,
	"language_code" text,
	"country_code" text,
	"favicon" text,
	"robots" text,
	"viewport" text,
	"template" text,
	"content_type" text,
	"og_title" text,
	"og_title_alt" text,
	"og_description" text,
	"og_description_alt" text,
	"og_type" text,
	"og_image" text,
	"og_image_alt" text,
	"og_url" text,
	"og_url_alt" text,
	"og_locale" text,
	"og_locale_alt" text,
	"search_title" text,
	"ibm_com_search_appid" text,
	"ibm_com_search_scopes" text,
	"ibm_search_facet_field_hierarchy_01" text,
	"ibm_search_facet_field_hierarchy_03" text,
	"ibm_search_facet_field_keyword_01" text,
	"ibm_search_facet_field_text_01" text,
	"focus_area" text,
	"site_section" text,
	"dcterms_date" text,
	"proxy_used" text,
	"cache_state" text,
	"cached_at" timestamp with time zone,
	"page_status_code" integer,
	"summary" text,
	"screenshot" text,
	"actions" jsonb,
	"change_tracking" jsonb,
	"raw_response" jsonb,
	"warning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text,
	"normalized_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "individuals_linkedin_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"individual_id" uuid,
	"raw_data" jsonb NOT NULL,
	"post_type" text NOT NULL,
	"linkedin_post_id" text NOT NULL,
	"linkedin_url" text NOT NULL,
	"content" text,
	"content_attributes" jsonb,
	"author" jsonb,
	"author_name" text,
	"author_linkedin_url" text,
	"posted_at" timestamp with time zone,
	"posted_at_data" jsonb,
	"post_images" jsonb,
	"has_images" boolean DEFAULT false,
	"repost_id" text,
	"repost_data" jsonb,
	"is_repost" boolean DEFAULT false,
	"social_content" jsonb,
	"engagement" jsonb,
	"likes_count" integer DEFAULT 0,
	"comments_count" integer DEFAULT 0,
	"shares_count" integer DEFAULT 0,
	"impressions_count" integer DEFAULT 0,
	"reactions" jsonb,
	"comments" jsonb,
	"header" jsonb,
	"article" jsonb,
	"article_link" text,
	"article_title" text,
	"has_article" boolean DEFAULT false,
	"input" jsonb,
	"query" jsonb,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_avatar_url" text,
	"author_info" jsonb,
	"article_image_url" text,
	"article_description" text,
	CONSTRAINT "individuals_linkedin_posts_linkedin_post_id_key" UNIQUE("linkedin_post_id")
);
--> statement-breakpoint
CREATE TABLE "organization_ideas" (
	"source_organization_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_ideas_source_organization_url_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"external_organization_id" text,
	"organization_contrarian_ideas" json
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_clerk_org_id_key" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "intake_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"liveblocks_room_id" text,
	"name_and_title" text,
	"phone_and_email" text,
	"website_and_socials" text,
	"images_link" text,
	"start_date" date,
	"bio" text,
	"elevator_pitch" text,
	"guest_pieces" text,
	"interview_questions" text,
	"quotes" text,
	"talking_points" text,
	"collateral" text,
	"how_started" text,
	"why_started" text,
	"mission" text,
	"story" text,
	"previous_jobs" text,
	"offerings" text,
	"current_promotion" text,
	"problem_solution" text,
	"future_offerings" text,
	"location" text,
	"goals" text,
	"help_people" text,
	"categories" text,
	"press_targeting" text,
	"press_type" text,
	"specific_outlets" text,
	"status" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"generating_started_at" timestamp with time zone,
	CONSTRAINT "unique_org_intake" UNIQUE("brand_id"),
	CONSTRAINT "intake_forms_status_check" CHECK ((status IS NULL) OR (status = 'generating'::text))
);
--> statement-breakpoint
CREATE TABLE "brand_thesis" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"thesis_html" text NOT NULL,
	"contrarian_level" integer NOT NULL,
	"status" "organization_individual_thesis_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"thesis_supporting_evidence_html" text,
	"generating_started_at" timestamp with time zone,
	"status_reason" text,
	"status_changed_by_type" text,
	"status_changed_by_user_id" uuid,
	"status_changed_at" timestamp with time zone,
	CONSTRAINT "unique_org_level_thesis" UNIQUE("brand_id","thesis_html","contrarian_level"),
	CONSTRAINT "check_status_changed_by_type" CHECK ((status_changed_by_type = ANY (ARRAY['ai'::text, 'user'::text])) OR (status_changed_by_type IS NULL))
);
--> statement-breakpoint
CREATE TABLE "__drizzle_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "web_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"page_category" "web_page_category_enum",
	"should_scrape" boolean DEFAULT true,
	"domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_relations" (
	"source_brand_id" uuid NOT NULL,
	"target_brand_id" uuid NOT NULL,
	"relation_type" "organization_relation_type" DEFAULT 'other' NOT NULL,
	"relation_confidence_level" text,
	"relation_confidence_rationale" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"status" "organization_relation_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "organization_relations_pkey" PRIMARY KEY("source_brand_id","target_brand_id")
);
--> statement-breakpoint
CREATE TABLE "brand_individuals" (
	"brand_id" uuid NOT NULL,
	"individual_id" uuid NOT NULL,
	"organization_role" text NOT NULL,
	"joined_organization_at" timestamp with time zone,
	"belonging_confidence_rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"status" "organization_individual_status" DEFAULT 'active' NOT NULL,
	"belonging_confidence_level" "belonging_confidence_level_enum",
	CONSTRAINT "organization_individuals_pkey" PRIMARY KEY("brand_id","individual_id")
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individuals_pdl_enrichment" ADD CONSTRAINT "individuals_pdl_enrichment_individual_id_fkey" FOREIGN KEY ("individual_id") REFERENCES "public"."individuals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_supabase_storage_id_fkey" FOREIGN KEY ("supabase_storage_id") REFERENCES "public"."supabase_storage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_linkedin_posts" ADD CONSTRAINT "organizations_linkedin_posts_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sales_profiles" ADD CONSTRAINT "organization_sales_profiles_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individuals_linkedin_posts" ADD CONSTRAINT "individuals_linkedin_posts_individual_id_fkey" FOREIGN KEY ("individual_id") REFERENCES "public"."individuals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_thesis" ADD CONSTRAINT "organizations_individuals_aied_thesis_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_thesis" ADD CONSTRAINT "organizations_aied_thesis_status_changed_by_user_id_fkey" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_thesis" ADD CONSTRAINT "organizations_aied_thesis_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_relations" ADD CONSTRAINT "organization_relations_source_organization_id_fkey" FOREIGN KEY ("source_brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_relations" ADD CONSTRAINT "organization_relations_target_organization_id_fkey" FOREIGN KEY ("target_brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_individuals" ADD CONSTRAINT "organization_individuals_individual_id_fkey" FOREIGN KEY ("individual_id") REFERENCES "public"."individuals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_individuals" ADD CONSTRAINT "organization_individuals_organization_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_clerk_user_id_index" ON "users" USING btree ("clerk_user_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_brands_org_domain" ON "brands" USING btree ("org_id" text_ops,"domain" text_ops);--> statement-breakpoint
CREATE INDEX "idx_brands_org_id" ON "brands" USING btree ("org_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_organizations_categories" ON "brands" USING btree ("categories" text_ops) WHERE (categories IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_clerk_organization_id" ON "brands" USING btree ("clerk_org_id" text_ops) WHERE (clerk_org_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_domain_unique_index" ON "brands" USING btree ("domain" text_ops) WHERE (domain IS NOT NULL);--> statement-breakpoint
CREATE INDEX "organizations_logo_url_index" ON "brands" USING btree ("logo_url" text_ops) WHERE (logo_url IS NOT NULL);--> statement-breakpoint
CREATE INDEX "organizations_status_index" ON "brands" USING btree ("status" text_ops) WHERE (status IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_url_unique" ON "brands" USING btree ("url" text_ops) WHERE (url IS NOT NULL);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_education_index" ON "individuals_pdl_enrichment" USING gin ("education" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_experience_index" ON "individuals_pdl_enrichment" USING gin ("experience" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_individual_id_index" ON "individuals_pdl_enrichment" USING btree ("individual_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_interests_index" ON "individuals_pdl_enrichment" USING gin ("interests" array_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_job_company_location_country_index" ON "individuals_pdl_enrichment" USING btree ("job_company_location_country" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_job_company_name_index" ON "individuals_pdl_enrichment" USING btree ("job_company_name" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_likelihood_index" ON "individuals_pdl_enrichment" USING btree ("likelihood" int4_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_linkedin_url_index" ON "individuals_pdl_enrichment" USING btree ("linkedin_url" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_organization_url_index" ON "individuals_pdl_enrichment" USING btree ("organization_url" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_pdl_id_index" ON "individuals_pdl_enrichment" USING btree ("pdl_id" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_pdl_enrichment_raw_data_index" ON "individuals_pdl_enrichment" USING gin ("raw_data" jsonb_ops);--> statement-breakpoint
CREATE INDEX "media_assets_asset_type_index" ON "media_assets" USING btree ("asset_type" text_ops);--> statement-breakpoint
CREATE INDEX "media_assets_organization_id_index" ON "media_assets" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "media_assets_organization_id_is_shareable_index" ON "media_assets" USING btree ("brand_id" bool_ops,"is_shareable" uuid_ops);--> statement-breakpoint
CREATE INDEX "media_assets_supabase_storage_id_index" ON "media_assets" USING btree ("supabase_storage_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "supabase_storage_md5_hash_index" ON "supabase_storage" USING btree ("md5_hash" text_ops);--> statement-breakpoint
CREATE INDEX "supabase_storage_storage_bucket_storage_path_index" ON "supabase_storage" USING btree ("storage_bucket" text_ops,"storage_path" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_url_index" ON "individuals" USING btree ("linkedin_url" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_author_linkedin_url_index" ON "brand_linkedin_posts" USING btree ("author_linkedin_url" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_author_universal_name_index" ON "brand_linkedin_posts" USING btree ("author_universal_name" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_content_attributes_index" ON "brand_linkedin_posts" USING gin ("content_attributes" jsonb_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_content_search_idx" ON "brand_linkedin_posts" USING gin (to_tsvector('english'::regconfig, COALESCE(content, ''::text)) tsvector_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_engagement_index" ON "brand_linkedin_posts" USING gin ("engagement" jsonb_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_has_article_index" ON "brand_linkedin_posts" USING btree ("has_article" bool_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_is_repost_index" ON "brand_linkedin_posts" USING btree ("is_repost" bool_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_linkedin_post_id_index" ON "brand_linkedin_posts" USING btree ("linkedin_post_id" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_organization_id_index" ON "brand_linkedin_posts" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_post_type_index" ON "brand_linkedin_posts" USING btree ("post_type" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_posted_at_index" ON "brand_linkedin_posts" USING btree ("posted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_raw_data_index" ON "brand_linkedin_posts" USING gin ("raw_data" jsonb_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_reactions_index" ON "brand_linkedin_posts" USING gin ("reactions" jsonb_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_repost_id_index" ON "brand_linkedin_posts" USING btree ("repost_id" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_linkedin_posts_scraped_at_index" ON "brand_linkedin_posts" USING btree ("scraped_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_sales_profiles_expires" ON "brand_sales_profiles" USING btree ("expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_scraped_url_firecrawl_normalized_url" ON "scraped_url_firecrawl" USING btree ("normalized_url" text_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_actions_index" ON "scraped_url_firecrawl" USING gin ("actions" jsonb_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_content_search_idx" ON "scraped_url_firecrawl" USING gin (to_tsvector('english'::regconfig, COALESCE(content, ''::text)) tsvector_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_domain_index" ON "scraped_url_firecrawl" USING btree ("domain" text_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_markdown_search_idx" ON "scraped_url_firecrawl" USING gin (to_tsvector('english'::regconfig, COALESCE(markdown, ''::text)) tsvector_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "scraped_url_firecrawl_normalized_url_key" ON "scraped_url_firecrawl" USING btree ("normalized_url" text_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_page_status_code_index" ON "scraped_url_firecrawl" USING btree ("page_status_code" int4_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_raw_response_index" ON "scraped_url_firecrawl" USING gin ("raw_response" jsonb_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_scrape_id_index" ON "scraped_url_firecrawl" USING btree ("scrape_id" text_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_scraped_at_index" ON "scraped_url_firecrawl" USING btree ("scraped_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_source_url_index" ON "scraped_url_firecrawl" USING btree ("source_url" text_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_success_index" ON "scraped_url_firecrawl" USING btree ("success" bool_ops);--> statement-breakpoint
CREATE INDEX "scraped_url_firecrawl_url_index" ON "scraped_url_firecrawl" USING btree ("url" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_author_linkedin_url_index" ON "individuals_linkedin_posts" USING btree ("author_linkedin_url" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_content_attributes_index" ON "individuals_linkedin_posts" USING gin ("content_attributes" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_content_search_idx" ON "individuals_linkedin_posts" USING gin (to_tsvector('english'::regconfig, content) tsvector_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_engagement_index" ON "individuals_linkedin_posts" USING gin ("engagement" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_individual_id_index" ON "individuals_linkedin_posts" USING btree ("individual_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_is_repost_index" ON "individuals_linkedin_posts" USING btree ("is_repost" bool_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_linkedin_post_id_index" ON "individuals_linkedin_posts" USING btree ("linkedin_post_id" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_post_type_index" ON "individuals_linkedin_posts" USING btree ("post_type" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_posted_at_index" ON "individuals_linkedin_posts" USING btree ("posted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_raw_data_index" ON "individuals_linkedin_posts" USING gin ("raw_data" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_reactions_index" ON "individuals_linkedin_posts" USING gin ("reactions" jsonb_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_repost_id_index" ON "individuals_linkedin_posts" USING btree ("repost_id" text_ops);--> statement-breakpoint
CREATE INDEX "individuals_linkedin_posts_scraped_at_index" ON "individuals_linkedin_posts" USING btree ("scraped_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orgs_clerk_id" ON "orgs" USING btree ("clerk_org_id" text_ops);--> statement-breakpoint
CREATE INDEX "intake_forms_liveblocks_room_id_index" ON "intake_forms" USING btree ("liveblocks_room_id" text_ops) WHERE (liveblocks_room_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "intake_forms_organization_id_index" ON "intake_forms" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "intake_forms_status_index" ON "intake_forms" USING btree ("status" text_ops) WHERE (status IS NOT NULL);--> statement-breakpoint
CREATE INDEX "organizations_aied_thesis_generating_started_at_index" ON "brand_thesis" USING btree ("generating_started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "organizations_individuals_aied_thesis_contrarian_level_index" ON "brand_thesis" USING btree ("contrarian_level" int4_ops);--> statement-breakpoint
CREATE INDEX "organizations_individuals_aied_thesis_organization_id_index" ON "brand_thesis" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "organizations_individuals_aied_thesis_status_index" ON "brand_thesis" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_web_pages_domain" ON "web_pages" USING btree ("domain" text_ops);--> statement-breakpoint
CREATE INDEX "idx_web_pages_should_scrape" ON "web_pages" USING btree ("should_scrape" bool_ops) WHERE (should_scrape = true);--> statement-breakpoint
CREATE INDEX "idx_web_pages_url" ON "web_pages" USING btree ("url" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "web_pages_normalized_url_key" ON "web_pages" USING btree ("normalized_url" text_ops);--> statement-breakpoint
CREATE INDEX "organization_relations_status_index" ON "brand_relations" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "organization_individuals_individual_id_index" ON "brand_individuals" USING btree ("individual_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "organization_individuals_organization_id_index" ON "brand_individuals" USING btree ("brand_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "organization_individuals_status_index" ON "brand_individuals" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE VIEW "public"."v_individuals_linkedin_posts" AS (SELECT o.external_organization_id, lp.id AS post_id, i.id AS individual_id, TRIM(BOTH FROM concat(i.first_name, ' ', i.last_name)) AS individual_name, lp.linkedin_post_id, lp.linkedin_url, lp.post_type, lp.content, lp.author_name, lp.author_linkedin_url, lp.author_avatar_url, lp.author_info, lp.article_image_url, lp.posted_at, lp.likes_count, lp.comments_count, lp.shares_count, lp.impressions_count, lp.has_images, lp.post_images, lp.is_repost, lp.repost_id, lp.scraped_at, lp.created_at, lp.updated_at FROM brands o JOIN brand_individuals oi ON o.id = oi.brand_id JOIN individuals i ON oi.individual_id = i.id JOIN individuals_linkedin_posts lp ON i.id = lp.individual_id WHERE lp.has_article = false ORDER BY o.external_organization_id, lp.posted_at DESC NULLS LAST, lp.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_organization_scraped_pages" AS (SELECT o.external_organization_id, s.id, s.url, s.domain, s.title, s.description, s.content, s.markdown, CASE WHEN s.content IS NOT NULL AND s.content <> ''::text THEN true ELSE false END AS has_content, s.scraped_at, s.created_at, wp.page_category FROM brands o JOIN web_pages wp ON o.domain = wp.domain JOIN scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url WHERE o.domain IS NOT NULL AND wp.domain IS NOT NULL AND s.raw_response IS NOT NULL ORDER BY o.external_organization_id, s.scraped_at DESC NULLS LAST, s.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_individuals_personal_content" AS (SELECT o.external_organization_id, s.id AS scraped_id, i.id AS individual_id, TRIM(BOTH FROM concat(i.first_name, ' ', i.last_name)) AS individual_name, s.url, s.domain, s.title, s.description, s.content, s.markdown, CASE WHEN s.content IS NOT NULL AND s.content <> ''::text THEN true ELSE false END AS has_content, s.scraped_at, s.created_at FROM brands o JOIN brand_individuals oi ON o.id = oi.brand_id JOIN individuals i ON oi.individual_id = i.id JOIN scraped_url_firecrawl s ON CASE WHEN i.personal_website_url IS NOT NULL THEN regexp_replace(regexp_replace(i.personal_website_url, '^https?://(www\.)?'::text, ''::text), '/.*$'::text, ''::text) ELSE NULL::text END = s.domain WHERE i.personal_website_url IS NOT NULL AND s.raw_response IS NOT NULL ORDER BY o.external_organization_id, s.scraped_at DESC NULLS LAST, s.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_organization_linkedin_posts" AS (SELECT o.external_organization_id, lp.id, lp.linkedin_post_id, lp.linkedin_url, lp.post_type, lp.content, lp.author_name, lp.author_linkedin_url, lp.author_universal_name, lp.author_avatar_url, lp.author_info, lp.article_image_url, lp.posted_at, lp.likes_count, lp.comments_count, lp.shares_count, lp.impressions_count, lp.has_images, lp.post_images, lp.is_repost, lp.repost_id, lp.scraped_at, lp.created_at, lp.updated_at FROM brands o JOIN brand_linkedin_posts lp ON o.id = lp.brand_id WHERE lp.has_article = false ORDER BY o.external_organization_id, lp.posted_at DESC NULLS LAST, lp.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_individuals_linkedin_articles" AS (SELECT o.external_organization_id, lp.id AS post_id, i.id AS individual_id, TRIM(BOTH FROM concat(i.first_name, ' ', i.last_name)) AS individual_name, lp.linkedin_post_id, lp.linkedin_url, lp.post_type, lp.content, lp.article_title, lp.article_link, lp.article_image_url, lp.article_description, lp.article, lp.author_name, lp.author_linkedin_url, lp.author_avatar_url, lp.author_info, lp.posted_at, lp.likes_count, lp.comments_count, lp.shares_count, lp.impressions_count, lp.has_images, lp.post_images, lp.is_repost, lp.repost_id, lp.scraped_at, lp.created_at, lp.updated_at, scraped.id AS scraped_id, scraped.source_url AS scraped_source_url, scraped.url AS scraped_url, scraped.domain AS scraped_domain, scraped.title AS scraped_title, scraped.description AS scraped_description, scraped.content AS scraped_content, scraped.markdown AS scraped_markdown, scraped.html AS scraped_html, scraped.raw_html AS scraped_raw_html, scraped.links AS scraped_links, scraped.language AS scraped_language, scraped.og_title AS scraped_og_title, scraped.og_description AS scraped_og_description, scraped.og_image AS scraped_og_image, scraped.scraped_at AS scraped_page_scraped_at, scraped.created_at AS scraped_page_created_at, CASE WHEN scraped.content IS NOT NULL AND scraped.content <> ''::text THEN true ELSE false END AS has_scraped_content FROM brands o JOIN brand_individuals oi ON o.id = oi.brand_id JOIN individuals i ON oi.individual_id = i.id JOIN individuals_linkedin_posts lp ON i.id = lp.individual_id LEFT JOIN scraped_url_firecrawl scraped ON lp.article_link = scraped.source_url WHERE lp.has_article = true ORDER BY o.external_organization_id, lp.posted_at DESC NULLS LAST, lp.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_organization_linkedin_articles" AS (SELECT o.external_organization_id, lp.id, lp.linkedin_post_id, lp.linkedin_url, lp.post_type, lp.content, lp.article_title, lp.article_link, lp.article_image_url, lp.article_description, lp.article, lp.author_name, lp.author_linkedin_url, lp.author_universal_name, lp.author_avatar_url, lp.author_info, lp.posted_at, lp.likes_count, lp.comments_count, lp.shares_count, lp.impressions_count, lp.has_images, lp.post_images, lp.is_repost, lp.repost_id, lp.scraped_at, lp.created_at, lp.updated_at, scraped.id AS scraped_id, scraped.source_url AS scraped_source_url, scraped.url AS scraped_url, scraped.domain AS scraped_domain, scraped.title AS scraped_title, scraped.description AS scraped_description, scraped.content AS scraped_content, scraped.markdown AS scraped_markdown, scraped.html AS scraped_html, scraped.raw_html AS scraped_raw_html, scraped.links AS scraped_links, scraped.language AS scraped_language, scraped.og_title AS scraped_og_title, scraped.og_description AS scraped_og_description, scraped.og_image AS scraped_og_image, scraped.scraped_at AS scraped_page_scraped_at, scraped.created_at AS scraped_page_created_at, CASE WHEN scraped.content IS NOT NULL AND scraped.content <> ''::text THEN true ELSE false END AS has_scraped_content FROM brands o JOIN brand_linkedin_posts lp ON o.id = lp.brand_id LEFT JOIN scraped_url_firecrawl scraped ON lp.article_link = scraped.source_url WHERE lp.has_article = true ORDER BY o.external_organization_id, lp.posted_at DESC NULLS LAST, lp.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_organization_individuals" AS (SELECT o.external_organization_id, i.id AS individual_id, i.first_name, i.last_name, TRIM(BOTH FROM concat(i.first_name, ' ', i.last_name)) AS full_name, i.linkedin_url, i.personal_website_url, CASE WHEN i.personal_website_url IS NOT NULL THEN regexp_replace(regexp_replace(i.personal_website_url, '^https?://(www\.)?'::text, ''::text), '/.*$'::text, ''::text) ELSE NULL::text END AS personal_domain, pdl.pdl_id, pdl.full_name AS pdl_full_name, pdl.location_name AS pdl_location_name, pdl.job_title AS pdl_job_title, pdl.job_company_name AS pdl_job_company_name, pdl.job_company_industry AS pdl_job_company_industry, pdl.linkedin_url AS pdl_linkedin_url, pdl.job_company_website AS pdl_job_company_website, pdl.twitter_url AS pdl_twitter_url, pdl.facebook_url AS pdl_facebook_url, pdl.github_url AS pdl_github_url, latest_post.author_avatar_url AS linkedin_author_avatar_url, latest_post.author_info AS linkedin_author_info, oi.created_at AS relation_created_at, i.created_at AS individual_created_at, oi.status AS relationship_status, oi.organization_role, oi.joined_organization_at, oi.belonging_confidence_level, oi.belonging_confidence_rationale FROM brands o JOIN brand_individuals oi ON o.id = oi.brand_id JOIN individuals i ON oi.individual_id = i.id LEFT JOIN individuals_pdl_enrichment pdl ON i.id = pdl.individual_id LEFT JOIN LATERAL ( SELECT lp.author_avatar_url, lp.author_info FROM individuals_linkedin_posts lp WHERE lp.individual_id = i.id ORDER BY lp.scraped_at DESC NULLS LAST, lp.created_at DESC LIMIT 1) latest_post ON true ORDER BY o.external_organization_id, oi.created_at DESC, i.created_at DESC);--> statement-breakpoint
CREATE VIEW "public"."v_target_organizations" AS (SELECT source_org.external_organization_id AS source_external_organization_id, target_org.id AS target_org_id, target_org.external_organization_id AS target_org_external_id, target_org.name AS target_org_name, target_org.url AS target_org_url, target_org.organization_linkedin_url AS target_org_linkedin_url, target_org.domain AS target_org_domain, rel.relation_type, rel.relation_confidence_level, rel.relation_confidence_rationale, rel.status AS relation_status, rel.created_at AS relation_created_at, rel.updated_at AS relation_updated_at, target_org.location AS target_org_location, target_org.bio AS target_org_bio, target_org.elevator_pitch AS target_org_elevator_pitch, target_org.mission AS target_org_mission, target_org.story AS target_org_story, target_org.offerings AS target_org_offerings, target_org.problem_solution AS target_org_problem_solution, target_org.goals AS target_org_goals, target_org.categories AS target_org_categories, target_org.founded_date AS target_org_founded_date, target_org.contact_name AS target_org_contact_name, target_org.contact_email AS target_org_contact_email, target_org.contact_phone AS target_org_contact_phone, target_org.social_media AS target_org_social_media FROM brands source_org JOIN brand_relations rel ON source_org.id = rel.source_brand_id JOIN brands target_org ON rel.target_brand_id = target_org.id ORDER BY source_org.external_organization_id, rel.created_at DESC);
*/