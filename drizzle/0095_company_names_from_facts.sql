-- A COMPANY IS SERVED WITH ITS NAME (owner 2026-10-17, "Adam Nasri @ Cifacom").
-- `POST /internal/companies/resolve` created ~46k brands with no name and the
-- vendor's name lived only in `company_facts.name`, while the batch read serves
-- `brands.name`. Every brand with NO name yet takes its `name` fact once.
-- Never over a stored name, never over one an org set (name_set_by_org_at),
-- never a name built from the domain. Idempotent (re-running matches nothing).
UPDATE "brands" AS b
   SET "name" = btrim(f."value" #>> '{}'), "updated_at" = NOW()
  FROM "company_facts" AS f
 WHERE f."brand_id" = b."id"
   AND f."fact_key" = 'name'
   AND jsonb_typeof(f."value") = 'string'
   AND btrim(f."value" #>> '{}') <> ''
   AND (b."name" IS NULL OR btrim(b."name") = '')
   AND b."name_set_by_org_at" IS NULL;
