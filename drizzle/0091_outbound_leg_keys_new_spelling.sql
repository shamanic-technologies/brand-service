-- THE OUTBOUND LEG RENAME, WAVE 2 (owner 2026-10-09). On an OUTBOUND feature
-- (the 10 slugs below, LOCKED), and only there:
--     start_to_conversation   ->  lead_found_to_conversation
--     start_to_website_visit  ->  lead_found_to_website_visit
-- Every stored row moves to the new spelling; the service writes and serves it
-- from now on and still ACCEPTS the legacy spelling on input
-- (`src/lib/outbound-leg-keys.ts`).
--
-- 1. brand_offer_selected_sales_paths.combination_keys: only a segment
--    `<legacy leg>@<outbound slug>` is rewritten; a non-outbound feature
--    (`start_to_website_visit@google-ads`) and an unattributed segment are kept
--    byte for byte.
-- 2. brand_offer_sales_paths.leg_keys: BARE keys, folded because the Sales path
--    surface only offers an entry leg cold email performs (outbound); see
--    `toNewSalesPathLegKeys`.
-- Two spellings of one key inside one array collapse onto ONE entry at the
-- position of the first (wave 1 already refused that on the selected paths, so
-- none is expected). stated_at is NOT touched: this is a rename, not a statement.
-- Idempotent: the WHERE clauses match only rows still holding a legacy key, and
-- the closing DO block refuses to finish if any is left.
-- Backup taken before deploy: /root/backups/manual/brand_offer_sales_paths_legacy_legs_20261009.sql.gz
UPDATE brand_offer_selected_sales_paths p
SET combination_keys = (
  SELECT array_agg(d.k ORDER BY d.first_ord)
  FROM (
    SELECT regexp_replace(u.c, '(^|\+)start_to_(conversation|website_visit)@(sales-cold-email-outreach|feedback-request-cold-email-outreach|sales-crm-email-outreach|cold-call-outreach|cold-instagram-outreach|cold-linkedin-outreach|cold-reddit-outreach|cold-sms-outreach|cold-whatsapp-outreach|cold-x-outreach)(?=\+|$)', '\1lead_found_to_\2@\3', 'g') AS k, min(u.ord) AS first_ord
    FROM unnest(p.combination_keys) WITH ORDINALITY AS u(c, ord)
    GROUP BY 1
  ) d
)
WHERE EXISTS (
  SELECT 1 FROM unnest(p.combination_keys) AS c(v)
  WHERE c.v ~ '(^|\+)start_to_(conversation|website_visit)@(sales-cold-email-outreach|feedback-request-cold-email-outreach|sales-crm-email-outreach|cold-call-outreach|cold-instagram-outreach|cold-linkedin-outreach|cold-reddit-outreach|cold-sms-outreach|cold-whatsapp-outreach|cold-x-outreach)(?=\+|$)'
);--> statement-breakpoint
UPDATE brand_offer_sales_paths p
SET leg_keys = (
  SELECT array_agg(d.k ORDER BY d.first_ord)
  FROM (
    SELECT CASE u.c
             WHEN 'start_to_conversation' THEN 'lead_found_to_conversation'
             WHEN 'start_to_website_visit' THEN 'lead_found_to_website_visit'
             ELSE u.c
           END AS k,
           min(u.ord) AS first_ord
    FROM unnest(p.leg_keys) WITH ORDINALITY AS u(c, ord)
    GROUP BY 1
  ) d
)
WHERE p.leg_keys && ARRAY['start_to_conversation', 'start_to_website_visit']::text[];--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM brand_offer_selected_sales_paths p, unnest(p.combination_keys) AS c(v)
    WHERE c.v ~ '(^|\+)start_to_(conversation|website_visit)@(sales-cold-email-outreach|feedback-request-cold-email-outreach|sales-crm-email-outreach|cold-call-outreach|cold-instagram-outreach|cold-linkedin-outreach|cold-reddit-outreach|cold-sms-outreach|cold-whatsapp-outreach|cold-x-outreach)(?=\+|$)'
  ) OR EXISTS (
    SELECT 1 FROM brand_offer_sales_paths
    WHERE leg_keys && ARRAY['start_to_conversation', 'start_to_website_visit']::text[]
  ) THEN
    RAISE EXCEPTION 'outbound leg rename: a legacy outbound leg key is still stored';
  END IF;
END $$;
