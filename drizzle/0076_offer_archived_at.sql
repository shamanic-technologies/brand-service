-- An owner can ARCHIVE an offer they no longer sell (or created by mistake) so it
-- leaves the default offer listing, and UNARCHIVE it to bring it back. Nothing is
-- deleted: campaigns, audiences and economics keep referencing the row. Additive
-- and nullable: every existing offer reads NULL, i.e. not archived.

ALTER TABLE "brand_offers" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
