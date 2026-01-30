/* eslint-disable camelcase */

/**
 * Migration: Update bulk_upsert_individuals to use clerk_organization_id
 * 
 * CHANGE: The function now accepts clerk_organization_id (org_xxx format) instead of
 * the deprecated external_organization_id (press-funnel internal UUID).
 * 
 * Function name is kept the same for backward compatibility with existing n8n workflows.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the existing function (parameter semantics change requires drop + create)
  pgm.sql(`DROP FUNCTION IF EXISTS bulk_upsert_individuals(text, jsonb);`);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_individuals(
      p_clerk_organization_id TEXT,
      p_individuals_data JSONB
    )
    RETURNS SETOF organization_individuals AS $$
    DECLARE
      v_organization_id UUID;
      v_individual_record JSONB;
      v_individual_id UUID;
      v_linkedin_url TEXT;
      v_first_name TEXT;
      v_last_name TEXT;
    BEGIN
      -- 1. Find source organization by clerk_organization_id
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE clerk_organization_id = p_clerk_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with clerk_organization_id % not found', p_clerk_organization_id;
      END IF;

      -- 2. Validate input
      IF jsonb_typeof(p_individuals_data) != 'array' THEN
        RAISE EXCEPTION 'p_individuals_data must be a JSON array';
      END IF;

      -- 3. Loop through individuals
      FOR v_individual_record IN SELECT * FROM jsonb_array_elements(p_individuals_data)
      LOOP
        v_linkedin_url := v_individual_record->>'linkedin_url';
        v_first_name := v_individual_record->>'first_name';
        v_last_name := v_individual_record->>'last_name';
        v_individual_id := NULL;

        -- 3a. Try to find individual by LinkedIn URL
        IF v_linkedin_url IS NOT NULL THEN
          SELECT id INTO v_individual_id
          FROM individuals
          WHERE linkedin_url = v_linkedin_url;
        END IF;

        -- 3b. If not found, try by name within the same organization context
        IF v_individual_id IS NULL THEN
          SELECT i.id INTO v_individual_id
          FROM individuals i
          JOIN organization_individuals oi ON i.id = oi.individual_id
          WHERE i.first_name = v_first_name 
            AND i.last_name = v_last_name
            AND oi.organization_id = v_organization_id;
        END IF;

        -- 3c. Upsert Individual
        IF v_individual_id IS NOT NULL THEN
          -- Update existing
          UPDATE individuals
          SET
            first_name = COALESCE(v_first_name, individuals.first_name),
            last_name = COALESCE(v_last_name, individuals.last_name),
            linkedin_url = COALESCE(v_linkedin_url, individuals.linkedin_url),
            personal_website_url = COALESCE(v_individual_record->>'personal_website_url', individuals.personal_website_url),
            updated_at = NOW()
          WHERE id = v_individual_id;
        ELSE
          -- Insert new
          INSERT INTO individuals (
            first_name, 
            last_name, 
            linkedin_url, 
            personal_website_url
          )
          VALUES (
            v_first_name, 
            v_last_name, 
            v_linkedin_url, 
            v_individual_record->>'personal_website_url'
          )
          RETURNING id INTO v_individual_id;
        END IF;

        -- 3d. Upsert Organization Relation
        RETURN QUERY
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
          v_individual_record->>'organization_role',
          (v_individual_record->>'joined_organization_at')::timestamptz,
          (v_individual_record->>'belonging_confidence_level')::belonging_confidence_level_enum,
          v_individual_record->>'belonging_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (organization_id, individual_id) DO UPDATE
        SET
          organization_role = COALESCE(EXCLUDED.organization_role, organization_individuals.organization_role),
          joined_organization_at = COALESCE(EXCLUDED.joined_organization_at, organization_individuals.joined_organization_at),
          belonging_confidence_level = COALESCE(EXCLUDED.belonging_confidence_level, organization_individuals.belonging_confidence_level),
          belonging_confidence_rationale = COALESCE(EXCLUDED.belonging_confidence_rationale, organization_individuals.belonging_confidence_rationale),
          updated_at = NOW()
        RETURNING *;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    COMMENT ON FUNCTION bulk_upsert_individuals IS 
      'Bulk upserts individuals and their association with an organization identified by clerk_organization_id (org_xxx format). '
      'Preserves existing data if input fields are null.';
  `);
};

exports.down = (pgm) => {
  // Revert to using external_organization_id
  pgm.sql(`DROP FUNCTION IF EXISTS bulk_upsert_individuals(text, jsonb);`);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_individuals(
      p_external_organization_id TEXT,
      p_individuals_data JSONB
    )
    RETURNS SETOF organization_individuals AS $$
    DECLARE
      v_organization_id UUID;
      v_individual_record JSONB;
      v_individual_id UUID;
      v_linkedin_url TEXT;
      v_first_name TEXT;
      v_last_name TEXT;
    BEGIN
      -- 1. Find source organization
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      -- 2. Validate input
      IF jsonb_typeof(p_individuals_data) != 'array' THEN
        RAISE EXCEPTION 'p_individuals_data must be a JSON array';
      END IF;

      -- 3. Loop through individuals
      FOR v_individual_record IN SELECT * FROM jsonb_array_elements(p_individuals_data)
      LOOP
        v_linkedin_url := v_individual_record->>'linkedin_url';
        v_first_name := v_individual_record->>'first_name';
        v_last_name := v_individual_record->>'last_name';
        v_individual_id := NULL;

        -- 3a. Try to find individual by LinkedIn URL
        IF v_linkedin_url IS NOT NULL THEN
          SELECT id INTO v_individual_id
          FROM individuals
          WHERE linkedin_url = v_linkedin_url;
        END IF;

        -- 3b. If not found, try by name within the same organization context
        IF v_individual_id IS NULL THEN
          SELECT i.id INTO v_individual_id
          FROM individuals i
          JOIN organization_individuals oi ON i.id = oi.individual_id
          WHERE i.first_name = v_first_name 
            AND i.last_name = v_last_name
            AND oi.organization_id = v_organization_id;
        END IF;

        -- 3c. Upsert Individual
        IF v_individual_id IS NOT NULL THEN
          -- Update existing
          UPDATE individuals
          SET
            first_name = COALESCE(v_first_name, individuals.first_name),
            last_name = COALESCE(v_last_name, individuals.last_name),
            linkedin_url = COALESCE(v_linkedin_url, individuals.linkedin_url),
            personal_website_url = COALESCE(v_individual_record->>'personal_website_url', individuals.personal_website_url),
            updated_at = NOW()
          WHERE id = v_individual_id;
        ELSE
          -- Insert new
          INSERT INTO individuals (
            first_name, 
            last_name, 
            linkedin_url, 
            personal_website_url
          )
          VALUES (
            v_first_name, 
            v_last_name, 
            v_linkedin_url, 
            v_individual_record->>'personal_website_url'
          )
          RETURNING id INTO v_individual_id;
        END IF;

        -- 3d. Upsert Organization Relation
        RETURN QUERY
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
          v_individual_record->>'organization_role',
          (v_individual_record->>'joined_organization_at')::timestamptz,
          (v_individual_record->>'belonging_confidence_level')::belonging_confidence_level_enum,
          v_individual_record->>'belonging_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (organization_id, individual_id) DO UPDATE
        SET
          organization_role = COALESCE(EXCLUDED.organization_role, organization_individuals.organization_role),
          joined_organization_at = COALESCE(EXCLUDED.joined_organization_at, organization_individuals.joined_organization_at),
          belonging_confidence_level = COALESCE(EXCLUDED.belonging_confidence_level, organization_individuals.belonging_confidence_level),
          belonging_confidence_rationale = COALESCE(EXCLUDED.belonging_confidence_rationale, organization_individuals.belonging_confidence_rationale),
          updated_at = NOW()
        RETURNING *;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

