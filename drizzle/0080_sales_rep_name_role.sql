-- The rep's first name and role (job title), so a hand-over can name them:
-- "I've copied Marie, Head of Partnerships at Doc Dinners". Both optional:
-- NULL means we were never told, never an empty string and never inferred
-- (not from the email's local part, not from the org owner's account).
--
-- Neither is a "fact" for `sales_rep_has_a_fact`: a name alone is not somebody
-- to reach. Idempotent.
ALTER TABLE "brand_sales_rep_phones" ADD COLUMN IF NOT EXISTS "first_name" text;--> statement-breakpoint
ALTER TABLE "brand_sales_rep_phones" ADD COLUMN IF NOT EXISTS "role" text;
