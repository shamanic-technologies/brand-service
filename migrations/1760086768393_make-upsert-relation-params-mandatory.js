/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Drop old function
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization_relation(text, text, text, text, text, text, text);`);
  
  // Create new function with mandatory parameters (except linkedin_url)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION upsert_organization_relation(
      p_source_external_organization_id text,
      p_target_organization_name text,
      p_target_organization_url text,
      p_relation_type text,
      p_relation_confidence_level text,
      p_relation_confidence_rationale text,
      p_target_organization_linkedin_url text DEFAULT NULL
    )
    RETURNS TABLE(
      source_org jsonb,
      target_org jsonb,
      relation jsonb,
      target_org_created boolean,
      relation_created boolean
    ) AS $$
    DECLARE
      v_source_org_id uuid;
      v_target_org_id uuid;
      v_target_domain text;
      v_target_org_created boolean := false;
      v_relation_created boolean := false;
    BEGIN
      -- 1. Find source organization by external_organization_id
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with external_organization_id: %', p_source_external_organization_id;
      END IF;

      -- 2. Extract domain from target URL for matching
      v_target_domain := extract_domain_from_url(p_target_organization_url);

      -- 3. Upsert target organization (match by domain)
      INSERT INTO organizations (
        name,
        url,
        organization_linkedin_url,
        domain,
        external_organization_id,
        created_at,
        updated_at
      )
      VALUES (
        p_target_organization_name,
        p_target_organization_url,
        p_target_organization_linkedin_url,
        v_target_domain,
        gen_random_uuid()::text,
        NOW(),
        NOW()
      )
      ON CONFLICT (domain) WHERE domain IS NOT NULL
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, organizations.name),
        url = COALESCE(EXCLUDED.url, organizations.url),
        organization_linkedin_url = COALESCE(EXCLUDED.organization_linkedin_url, organizations.organization_linkedin_url),
        updated_at = NOW()
      RETURNING id, (xmax = 0) INTO v_target_org_id, v_target_org_created;

      -- 4. Upsert relation between source and target
      INSERT INTO organization_relations (
        source_organization_id,
        target_organization_id,
        relation_type,
        relation_confidence_level,
        relation_confidence_rationale,
        created_at,
        updated_at
      )
      VALUES (
        v_source_org_id,
        v_target_org_id,
        p_relation_type,
        p_relation_confidence_level,
        p_relation_confidence_rationale,
        NOW(),
        NOW()
      )
      ON CONFLICT (source_organization_id, target_organization_id)
      DO UPDATE SET
        relation_type = COALESCE(EXCLUDED.relation_type, organization_relations.relation_type),
        relation_confidence_level = COALESCE(EXCLUDED.relation_confidence_level, organization_relations.relation_confidence_level),
        relation_confidence_rationale = COALESCE(EXCLUDED.relation_confidence_rationale, organization_relations.relation_confidence_rationale),
        updated_at = NOW()
      RETURNING (xmax = 0) INTO v_relation_created;

      -- 5. Return full rows as JSONB
      RETURN QUERY
      SELECT
        to_jsonb(source_orgs.*) AS source_org,
        to_jsonb(target_orgs.*) AS target_org,
        to_jsonb(rels.*) AS relation,
        v_target_org_created,
        v_relation_created
      FROM organizations source_orgs
      CROSS JOIN organizations target_orgs
      CROSS JOIN organization_relations rels
      WHERE 
        source_orgs.id = v_source_org_id
        AND target_orgs.id = v_target_org_id
        AND rels.source_organization_id = v_source_org_id
        AND rels.target_organization_id = v_target_org_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Update comment
  pgm.sql(`
    COMMENT ON FUNCTION upsert_organization_relation IS 'Upserts a target organization and creates/updates relation with source organization. All parameters are mandatory except linkedin_url. Source is identified by external_organization_id, target is matched by domain.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Restore old signature
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization_relation(text, text, text, text, text, text, text);`);
  
  pgm.sql(`
    CREATE OR REPLACE FUNCTION upsert_organization_relation(
      p_source_external_organization_id text,
      p_target_organization_name text,
      p_target_organization_url text,
      p_target_organization_linkedin_url text DEFAULT NULL,
      p_relation_type text DEFAULT NULL,
      p_relation_confidence_level text DEFAULT NULL,
      p_relation_confidence_rationale text DEFAULT NULL
    )
    RETURNS TABLE(
      source_org jsonb,
      target_org jsonb,
      relation jsonb,
      target_org_created boolean,
      relation_created boolean
    ) AS $$
    DECLARE
      v_source_org_id uuid;
      v_target_org_id uuid;
      v_target_domain text;
      v_target_org_created boolean := false;
      v_relation_created boolean := false;
    BEGIN
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with external_organization_id: %', p_source_external_organization_id;
      END IF;

      v_target_domain := extract_domain_from_url(p_target_organization_url);

      INSERT INTO organizations (
        name,
        url,
        organization_linkedin_url,
        domain,
        external_organization_id,
        created_at,
        updated_at
      )
      VALUES (
        p_target_organization_name,
        p_target_organization_url,
        p_target_organization_linkedin_url,
        v_target_domain,
        gen_random_uuid()::text,
        NOW(),
        NOW()
      )
      ON CONFLICT (domain) WHERE domain IS NOT NULL
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, organizations.name),
        url = COALESCE(EXCLUDED.url, organizations.url),
        organization_linkedin_url = COALESCE(EXCLUDED.organization_linkedin_url, organizations.organization_linkedin_url),
        updated_at = NOW()
      RETURNING id, (xmax = 0) INTO v_target_org_id, v_target_org_created;

      INSERT INTO organization_relations (
        source_organization_id,
        target_organization_id,
        relation_type,
        relation_confidence_level,
        relation_confidence_rationale,
        created_at,
        updated_at
      )
      VALUES (
        v_source_org_id,
        v_target_org_id,
        p_relation_type,
        p_relation_confidence_level,
        p_relation_confidence_rationale,
        NOW(),
        NOW()
      )
      ON CONFLICT (source_organization_id, target_organization_id)
      DO UPDATE SET
        relation_type = COALESCE(EXCLUDED.relation_type, organization_relations.relation_type),
        relation_confidence_level = COALESCE(EXCLUDED.relation_confidence_level, organization_relations.relation_confidence_level),
        relation_confidence_rationale = COALESCE(EXCLUDED.relation_confidence_rationale, organization_relations.relation_confidence_rationale),
        updated_at = NOW()
      RETURNING (xmax = 0) INTO v_relation_created;

      RETURN QUERY
      SELECT
        to_jsonb(source_orgs.*) AS source_org,
        to_jsonb(target_orgs.*) AS target_org,
        to_jsonb(rels.*) AS relation,
        v_target_org_created,
        v_relation_created
      FROM organizations source_orgs
      CROSS JOIN organizations target_orgs
      CROSS JOIN organization_relations rels
      WHERE 
        source_orgs.id = v_source_org_id
        AND target_orgs.id = v_target_org_id
        AND rels.source_organization_id = v_source_org_id
        AND rels.target_organization_id = v_target_org_id;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
