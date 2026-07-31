-- Which org shared the brand, recorded ON the credential.
--
-- A share credential is minted through an org-scoped, brand-ownership-checked
-- route, so the writer already knows the answer and threw it away. Deriving it
-- on read from `org_brands` cannot work: 21 production brands are claimed by
-- more than one org and 18 by none, so the membership table answers "ambiguous"
-- or "nothing" exactly where the renderer needs one org.
--
-- Numbered 0048 on purpose: 0046 (sales funnel declarations) and 0047
-- (org-scoped brand config) are in flight on other branches, and reusing either
-- number would collide on the file name at merge. Journal order drives the
-- migrator; the idx gap is informational only.
ALTER TABLE "brand_share_tokens" ADD COLUMN IF NOT EXISTS "org_id" uuid;--> statement-breakpoint
-- Backfill: every row that predates the column is attributed to the org that
-- claimed the brand FIRST. Production holds exactly one such row and its brand
-- has exactly one claim, so this is unambiguous today; the ORDER BY keeps it
-- deterministic if a multi-claimed row ever reaches this statement.
UPDATE "brand_share_tokens" t
SET "org_id" = (
	SELECT o."org_id"
	FROM "org_brands" o
	WHERE o."brand_id" = t."brand_id"
	ORDER BY o."claimed_at" ASC, o."org_id" ASC
	LIMIT 1
)
WHERE t."org_id" IS NULL;--> statement-breakpoint
-- NOT NULL rather than a nullable column plus a read-time fallback: the resolve
-- must answer with one org or refuse, and a fallback is exactly the "plausible
-- stand-in" this table must never serve. Every future row carries the org by
-- construction (the mint route rejects a brand the caller's org does not claim),
-- so this can only fail on a legacy row whose brand no org claims — none exist,
-- and a failure here is a real migration failure, not something to paper over by
-- deleting somebody's credential.
ALTER TABLE "brand_share_tokens" ALTER COLUMN "org_id" SET NOT NULL;
