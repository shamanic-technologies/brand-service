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
  // Update function to use COALESCE for relations too
  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_organization_relations(
      p_source_external_organization_id TEXT,
      p_relations_data JSONB
    )
    RETURNS SETOF organization_relations AS $$
    DECLARE
      v_source_org_id UUID;
      v_relation_record JSONB;
      v_target_org_id UUID;
      v_target_domain TEXT;
    BEGIN
      -- 1. Find source organization by external_organization_id
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with external_organization_id: %', p_source_external_organization_id;
      END IF;

      -- 2. Validate input is array
      IF jsonb_typeof(p_relations_data) != 'array' THEN
        RAISE EXCEPTION 'p_relations_data must be a JSON array';
      END IF;

      -- 3. Loop through each relation record
      FOR v_relation_record IN SELECT * FROM jsonb_array_elements(p_relations_data)
      LOOP
        -- Extract domain from target URL
        v_target_domain := extract_domain_from_url(v_relation_record->>'target_organization_url');

        -- Upsert target organization (match by domain)
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
          v_relation_record->>'target_organization_name',
          v_relation_record->>'target_organization_url',
          v_relation_record->>'target_organization_linkedin_url',
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
        RETURNING id INTO v_target_org_id;

        -- Upsert relation between source and target
        -- FIXED: Added COALESCE to prevent overwriting existing data with NULL
        RETURN QUERY
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
          (v_relation_record->>'relation_type')::organization_relation_type,
          v_relation_record->>'relation_confidence_level',
          v_relation_record->>'relation_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (source_organization_id, target_organization_id)
        DO UPDATE SET
          relation_type = COALESCE(EXCLUDED.relation_type, organization_relations.relation_type),
          relation_confidence_level = COALESCE(EXCLUDED.relation_confidence_level, organization_relations.relation_confidence_level),
          relation_confidence_rationale = COALESCE(EXCLUDED.relation_confidence_rationale, organization_relations.relation_confidence_rationale),
          updated_at = NOW()
        RETURNING *;
      END LOOP;
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
  // Revert to the version without COALESCE on relations (technically the previous state)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_organization_relations(
      p_source_external_organization_id TEXT,
      p_relations_data JSONB
    )
    RETURNS SETOF organization_relations AS $$
    DECLARE
      v_source_org_id UUID;
      v_relation_record JSONB;
      v_target_org_id UUID;
      v_target_domain TEXT;
    BEGIN
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with external_organization_id: %', p_source_external_organization_id;
      END IF;

      IF jsonb_typeof(p_relations_data) != 'array' THEN
        RAISE EXCEPTION 'p_relations_data must be a JSON array';
      END IF;

      FOR v_relation_record IN SELECT * FROM jsonb_array_elements(p_relations_data)
      LOOP
        v_target_domain := extract_domain_from_url(v_relation_record->>'target_organization_url');

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
          v_relation_record->>'target_organization_name',
          v_relation_record->>'target_organization_url',
          v_relation_record->>'target_organization_linkedin_url',
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
        RETURNING id INTO v_target_org_id;

        RETURN QUERY
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
          (v_relation_record->>'relation_type')::organization_relation_type,
          v_relation_record->>'relation_confidence_level',
          v_relation_record->>'relation_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (source_organization_id, target_organization_id)
        DO UPDATE SET
          relation_type = EXCLUDED.relation_type,
          relation_confidence_level = EXCLUDED.relation_confidence_level,
          relation_confidence_rationale = EXCLUDED.relation_confidence_rationale,
          updated_at = NOW()
        RETURNING *;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
