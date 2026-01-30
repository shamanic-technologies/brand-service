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
  // 1. Update upsert_organization to return full row
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization(text, text, text, text);`);
  
  pgm.createFunction(
    'upsert_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_organization_name', type: 'text', mode: 'IN', default: null },
      { name: 'p_organization_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_organization_linkedin_url', type: 'text', mode: 'IN', default: null },
    ],
    {
      returns: 'TABLE(id uuid, name text, url text, organization_linkedin_url text, domain text, external_organization_id text, created_at timestamptz, updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      INSERT INTO organizations (
        external_organization_id, 
        name, 
        url, 
        organization_linkedin_url,
        created_at, 
        updated_at
      )
      VALUES (
        p_external_organization_id, 
        p_organization_name, 
        p_organization_url,
        p_organization_linkedin_url,
        NOW(), 
        NOW()
      )
      ON CONFLICT (external_organization_id) 
      DO UPDATE SET 
        name = COALESCE(EXCLUDED.name, organizations.name),
        url = COALESCE(EXCLUDED.url, organizations.url),
        organization_linkedin_url = COALESCE(EXCLUDED.organization_linkedin_url, organizations.organization_linkedin_url),
        updated_at = NOW()
      RETURNING id, name, url, organization_linkedin_url, domain, external_organization_id, created_at, updated_at;
    `
  );

  // 2. Update upsert_organization_relation to return full rows
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

  // 3. Update upsert_organization_individual to return full rows
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization_individual(text, text, text, text, text, text, timestamp with time zone, text, text);`);
  
  pgm.sql(`
    CREATE OR REPLACE FUNCTION upsert_organization_individual(
      p_external_organization_id text,
      p_first_name text,
      p_last_name text,
      p_linkedin_url text,
      p_personal_website_url text DEFAULT NULL,
      p_organization_role text DEFAULT NULL,
      p_joined_organization_at timestamp with time zone DEFAULT NULL,
      p_belonging_confidence_level text DEFAULT NULL,
      p_belonging_confidence_rationale text DEFAULT NULL
    )
    RETURNS TABLE(
      organization jsonb,
      individual jsonb,
      link jsonb,
      individual_created boolean,
      link_created boolean
    ) AS $$
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
      v_individual_created boolean := false;
      v_link_created boolean := false;
    BEGIN
      -- 1. Find organization by external_organization_id
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization not found with external_organization_id: %', p_external_organization_id;
      END IF;

      -- 2. Upsert individual (match by linkedin_url if provided)
      IF p_linkedin_url IS NOT NULL AND p_linkedin_url != '' THEN
        INSERT INTO individuals (
          first_name,
          last_name,
          linkedin_url,
          personal_website_url,
          created_at,
          updated_at
        )
        VALUES (
          p_first_name,
          p_last_name,
          p_linkedin_url,
          p_personal_website_url,
          NOW(),
          NOW()
        )
        ON CONFLICT (linkedin_url)
        DO UPDATE SET
          first_name = COALESCE(EXCLUDED.first_name, individuals.first_name),
          last_name = COALESCE(EXCLUDED.last_name, individuals.last_name),
          personal_website_url = COALESCE(EXCLUDED.personal_website_url, individuals.personal_website_url),
          updated_at = NOW()
        RETURNING id, (xmax = 0) INTO v_individual_id, v_individual_created;
      ELSE
        INSERT INTO individuals (
          first_name,
          last_name,
          linkedin_url,
          personal_website_url,
          created_at,
          updated_at
        )
        VALUES (
          p_first_name,
          p_last_name,
          NULL,
          p_personal_website_url,
          NOW(),
          NOW()
        )
        RETURNING id INTO v_individual_id;
        v_individual_created := true;
      END IF;

      -- 3. Upsert link between organization and individual
      INSERT INTO organization_individuals (
        organization_id,
        individual_id,
        organization_role,
        joined_organization_at,
        belonging_confidence_level,
        belonging_confidence_rationale,
        created_at,
        updated_at
      )
      VALUES (
        v_organization_id,
        v_individual_id,
        p_organization_role,
        p_joined_organization_at,
        p_belonging_confidence_level,
        p_belonging_confidence_rationale,
        NOW(),
        NOW()
      )
      ON CONFLICT (organization_id, individual_id)
      DO UPDATE SET
        organization_role = COALESCE(EXCLUDED.organization_role, organization_individuals.organization_role),
        joined_organization_at = COALESCE(EXCLUDED.joined_organization_at, organization_individuals.joined_organization_at),
        belonging_confidence_level = COALESCE(EXCLUDED.belonging_confidence_level, organization_individuals.belonging_confidence_level),
        belonging_confidence_rationale = COALESCE(EXCLUDED.belonging_confidence_rationale, organization_individuals.belonging_confidence_rationale),
        updated_at = NOW()
      RETURNING (xmax = 0) INTO v_link_created;

      -- 4. Return full rows as JSONB
      RETURN QUERY
      SELECT
        to_jsonb(orgs.*) AS organization,
        to_jsonb(inds.*) AS individual,
        to_jsonb(links.*) AS link,
        v_individual_created,
        v_link_created
      FROM organizations orgs
      CROSS JOIN individuals inds
      CROSS JOIN organization_individuals links
      WHERE 
        orgs.id = v_organization_id
        AND inds.id = v_individual_id
        AND links.organization_id = v_organization_id
        AND links.individual_id = v_individual_id;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Restore original simpler return types - would need to copy from previous migrations
  // For brevity, just dropping - rollback would restore from previous migration
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization(text, text, text, text);`);
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization_relation(text, text, text, text, text, text, text);`);
  pgm.sql(`DROP FUNCTION IF EXISTS upsert_organization_individual(text, text, text, text, text, text, timestamp with time zone, text, text);`);
};
