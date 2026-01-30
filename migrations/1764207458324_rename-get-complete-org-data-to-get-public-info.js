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
  // 1. Drop the old function
  pgm.dropFunction('get_complete_organization_data', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);

  // 2. Create the new function with the exact same logic
  pgm.createFunction(
    'get_public_information',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_result jsonb;
      v_main_org jsonb;
      v_related_orgs jsonb;
    BEGIN
      -- Get main organization data (basic fields only)
      SELECT jsonb_build_object(
        'id', o.id,
        'external_organization_id', o.external_organization_id,
        'name', o.name,
        'url', o.url,
        'organization_linkedin_url', o.organization_linkedin_url,
        'domain', o.domain,
        'status', o.status,
        'generating_started_at', o.generating_started_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at
      ) INTO v_main_org
      FROM organizations o
      WHERE o.external_organization_id = p_external_organization_id;

      -- Get related organizations with their complete data
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'relation_type', rel.relation_type,
          'relation_confidence_level', rel.relation_confidence_level,
          'relation_confidence_rationale', rel.relation_confidence_rationale,
          'relation_status', rel.status,
          'relation_created_at', rel.created_at,
          'relation_updated_at', rel.updated_at,
          'organization', get_organization_complete_content_json(target_org.id)
        )
      ), '[]'::jsonb) INTO v_related_orgs
      FROM organizations AS source_org
      INNER JOIN organization_relations AS rel ON source_org.id = rel.source_organization_id
      INNER JOIN organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE source_org.external_organization_id = p_external_organization_id;

      -- Build final result
      v_result := jsonb_build_object(
        'main_organization', v_main_org,
        'related_organizations', v_related_orgs
      );

      RETURN v_result;
    END;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_public_information IS 'Returns 100% of public data for an organization by external_organization_id. Includes main organization basic info and all related organizations with their complete content. Returns structured JSON.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // 1. Drop the new function
  pgm.dropFunction('get_public_information', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);

  // 2. Re-create the old function
  pgm.createFunction(
    'get_complete_organization_data',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_result jsonb;
      v_main_org jsonb;
      v_related_orgs jsonb;
    BEGIN
      -- Get main organization data (basic fields only)
      SELECT jsonb_build_object(
        'id', o.id,
        'external_organization_id', o.external_organization_id,
        'name', o.name,
        'url', o.url,
        'organization_linkedin_url', o.organization_linkedin_url,
        'domain', o.domain,
        'status', o.status,
        'generating_started_at', o.generating_started_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at
      ) INTO v_main_org
      FROM organizations o
      WHERE o.external_organization_id = p_external_organization_id;

      -- Get related organizations with their complete data
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'relation_type', rel.relation_type,
          'relation_confidence_level', rel.relation_confidence_level,
          'relation_confidence_rationale', rel.relation_confidence_rationale,
          'relation_status', rel.status,
          'relation_created_at', rel.created_at,
          'relation_updated_at', rel.updated_at,
          'organization', get_organization_complete_content_json(target_org.id)
        )
      ), '[]'::jsonb) INTO v_related_orgs
      FROM organizations AS source_org
      INNER JOIN organization_relations AS rel ON source_org.id = rel.source_organization_id
      INNER JOIN organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE source_org.external_organization_id = p_external_organization_id;

      -- Build final result
      v_result := jsonb_build_object(
        'main_organization', v_main_org,
        'related_organizations', v_related_orgs
      );

      RETURN v_result;
    END;
    `
  );
};
