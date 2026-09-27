-- An offer created from a free-text description of what a brand sells carries
-- the one-sentence description and the icon token the customer confirmed
-- (`POST /orgs/brands/:brandId/offers/confirm`). Additive and nullable: every
-- existing offer reads NULL for both, which is the honest "never stated".

ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "icon" text;
