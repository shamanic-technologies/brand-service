-- A cached URL map records whether it was taken with the brand's subdomains
-- included. Every existing row predates that (false) and is ignored on read,
-- so the next extraction re-maps the site with its subdomains.
ALTER TABLE IF EXISTS "url_map_cache" ADD COLUMN IF NOT EXISTS "includes_subdomains" boolean DEFAULT false NOT NULL;
