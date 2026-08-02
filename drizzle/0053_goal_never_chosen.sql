-- "No goal chosen" becomes representable.
--
-- `current_goal` carried a DEFAULT of a real goal — `purchase`, respelled to
-- `websitePurchase` by 0051. So a row that had never been told a goal was
-- indistinguishable from one that had chosen website purchase, and every read
-- answered a plausible goal for a brand that had never picked one.
--
-- That is not hypothetical. The column landed on 2026-06-17 with this default
-- and no backfill of the goals brands had already chosen, so 14 brands that
-- picked sales meetings were served website purchase for six weeks, and their
-- campaigns optimized for it. Those rows were repaired on 2026-08-01; this
-- removes the trap that produced them.
--
-- Dropping the default without allowing NULL would break brand creation: all
-- four `org_brands` inserts omit the goal and rely on it. So the column becomes
-- nullable and NULL means exactly "this org has not said". The runtime-context
-- read already 404s on an unresolvable goal, which is the honest answer —
-- a consumer that needs a goal fails loud instead of running on a fabricated one.
--
-- EXISTING rows are left exactly as they are. Which of them were deliberate and
-- which were the default is no longer recoverable, and guessing would re-create
-- the problem in the other direction. This stops it going forward only.
--
-- Idempotent: both statements are no-ops once applied.

ALTER TABLE "org_brands" ALTER COLUMN "current_goal" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "org_brands" ALTER COLUMN "current_goal" DROP NOT NULL;
