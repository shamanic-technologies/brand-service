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
  // Create function to upsert individual and link to organization
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
      result_organization_id uuid,
      result_organization_name text,
      result_individual_id uuid,
      result_individual_name text,
      result_individual_created boolean,
      result_link_created boolean
    ) AS $$
    DECLARE
      v_organization_id uuid;
      v_organization_name text;
      v_individual_id uuid;
      v_individual_created boolean := false;
      v_link_created boolean := false;
    BEGIN
      -- 1. Find organization by external_organization_id
      SELECT id, name INTO v_organization_id, v_organization_name
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization not found with external_organization_id: %', p_external_organization_id;
      END IF;

      -- 2. Upsert individual (match by linkedin_url if provided, otherwise always create new)
      IF p_linkedin_url IS NOT NULL AND p_linkedin_url != '' THEN
        -- Match by linkedin_url
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
        -- No linkedin_url, always create new individual
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

      -- 4. Return result
      RETURN QUERY
      SELECT
        v_organization_id,
        v_organization_name,
        v_individual_id,
        CONCAT(p_first_name, ' ', p_last_name)::text,
        v_individual_created,
        v_link_created;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION upsert_organization_individual IS 'Upserts an individual and creates/updates their link to an organization. Individual is matched by linkedin_url if provided. Organization is identified by external_organization_id.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_organization_individual(text, text, text, text, text, text, timestamp with time zone, text, text);
  `);
};
