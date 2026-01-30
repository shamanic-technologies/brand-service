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
  // Drop the existing function first since we're changing the return type
  pgm.dropFunction('upsert_individual_with_organization', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_first_name', type: 'text' },
    { name: 'p_last_name', type: 'text' },
    { name: 'p_organization_role', type: 'text' },
    { name: 'p_belonging_confidence_level', type: 'text' },
    { name: 'p_belonging_confidence_rationale', type: 'text' },
    { name: 'p_linkedin_url', type: 'text' },
    { name: 'p_personal_website_url', type: 'text' },
    { name: 'p_joined_organization_at', type: 'timestamptz' },
  ]);

  // Create the function with renamed return columns to avoid ambiguity
  pgm.createFunction(
    'upsert_individual_with_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_first_name', type: 'text', mode: 'IN' },
      { name: 'p_last_name', type: 'text', mode: 'IN' },
      { name: 'p_organization_role', type: 'text', mode: 'IN' },
      { name: 'p_belonging_confidence_level', type: 'text', mode: 'IN' },
      { name: 'p_belonging_confidence_rationale', type: 'text', mode: 'IN' },
      { name: 'p_linkedin_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_personal_website_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_joined_organization_at', type: 'timestamptz', mode: 'IN', default: null },
    ],
    {
      returns: 'TABLE(result_individual_id uuid, result_organization_id uuid)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- If organization not found, raise an exception
      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      -- Try to find the individual by linkedin_url if provided
      IF p_linkedin_url IS NOT NULL THEN
        SELECT individuals.id INTO v_individual_id 
        FROM individuals 
        WHERE individuals.linkedin_url = p_linkedin_url;
      END IF;
      
      -- If not found by linkedin_url, try by name for the given organization
      IF v_individual_id IS NULL THEN
        SELECT i.id INTO v_individual_id 
        FROM individuals i
        JOIN organization_individuals oi ON i.id = oi.individual_id
        WHERE i.first_name = p_first_name 
          AND i.last_name = p_last_name 
          AND oi.organization_id = v_organization_id;
      END IF;

      -- If individual is found, update them
      IF v_individual_id IS NOT NULL THEN
        UPDATE individuals
        SET
          first_name = p_first_name,
          last_name = p_last_name,
          linkedin_url = COALESCE(p_linkedin_url, individuals.linkedin_url),
          personal_website_url = COALESCE(p_personal_website_url, individuals.personal_website_url),
          updated_at = NOW()
        WHERE individuals.id = v_individual_id;
      ELSE
        -- If individual is not found, insert a new one
        INSERT INTO individuals (first_name, last_name, linkedin_url, personal_website_url)
        VALUES (p_first_name, p_last_name, p_linkedin_url, p_personal_website_url)
        RETURNING individuals.id INTO v_individual_id;
      END IF;

      -- Upsert the organization_individual link
      INSERT INTO organization_individuals (organization_id, individual_id, organization_role, joined_organization_at, belonging_confidence_level, belonging_confidence_rationale)
      VALUES (v_organization_id, v_individual_id, p_organization_role, p_joined_organization_at, p_belonging_confidence_level, p_belonging_confidence_rationale)
      ON CONFLICT (organization_id, individual_id) DO UPDATE
      SET
        organization_role = EXCLUDED.organization_role,
        joined_organization_at = EXCLUDED.joined_organization_at,
        belonging_confidence_level = EXCLUDED.belonging_confidence_level,
        belonging_confidence_rationale = EXCLUDED.belonging_confidence_rationale,
        updated_at = NOW();

      -- Return the ids with explicit aliases to avoid ambiguity
      RETURN QUERY SELECT v_individual_id AS result_individual_id, v_organization_id AS result_organization_id;
    END;
    `,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Restore the previous version
  pgm.createFunction(
    'upsert_individual_with_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_first_name', type: 'text', mode: 'IN' },
      { name: 'p_last_name', type: 'text', mode: 'IN' },
      { name: 'p_organization_role', type: 'text', mode: 'IN' },
      { name: 'p_belonging_confidence_level', type: 'text', mode: 'IN' },
      { name: 'p_belonging_confidence_rationale', type: 'text', mode: 'IN' },
      { name: 'p_linkedin_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_personal_website_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_joined_organization_at', type: 'timestamptz', mode: 'IN', default: null },
    ],
    {
      returns: 'TABLE(individual_id uuid, organization_id uuid)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT id INTO v_organization_id FROM organizations WHERE external_organization_id = p_external_organization_id;

      -- If organization not found, raise an exception
      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      -- Try to find the individual by linkedin_url if provided
      IF p_linkedin_url IS NOT NULL THEN
        SELECT id INTO v_individual_id FROM individuals WHERE linkedin_url = p_linkedin_url;
      END IF;
      
      -- If not found by linkedin_url, try by name for the given organization
      IF v_individual_id IS NULL THEN
        SELECT i.id INTO v_individual_id 
        FROM individuals i
        JOIN organization_individuals oi ON i.id = oi.individual_id
        WHERE i.first_name = p_first_name 
          AND i.last_name = p_last_name 
          AND oi.organization_id = v_organization_id;
      END IF;

      -- If individual is found, update them
      IF v_individual_id IS NOT NULL THEN
        UPDATE individuals
        SET
          first_name = p_first_name,
          last_name = p_last_name,
          linkedin_url = COALESCE(p_linkedin_url, individuals.linkedin_url),
          personal_website_url = COALESCE(p_personal_website_url, individuals.personal_website_url),
          updated_at = NOW()
        WHERE id = v_individual_id;
      ELSE
        -- If individual is not found, insert a new one
        INSERT INTO individuals (first_name, last_name, linkedin_url, personal_website_url)
        VALUES (p_first_name, p_last_name, p_linkedin_url, p_personal_website_url)
        RETURNING id INTO v_individual_id;
      END IF;

      -- Upsert the organization_individual link
      INSERT INTO organization_individuals (organization_id, individual_id, organization_role, joined_organization_at, belonging_confidence_level, belonging_confidence_rationale)
      VALUES (v_organization_id, v_individual_id, p_organization_role, p_joined_organization_at, p_belonging_confidence_level, p_belonging_confidence_rationale)
      ON CONFLICT (organization_id, individual_id) DO UPDATE
      SET
        organization_role = EXCLUDED.organization_role,
        joined_organization_at = EXCLUDED.joined_organization_at,
        belonging_confidence_level = EXCLUDED.belonging_confidence_level,
        belonging_confidence_rationale = EXCLUDED.belonging_confidence_rationale,
        updated_at = NOW();

      -- Return the ids with explicit aliases to avoid ambiguity
      RETURN QUERY SELECT v_individual_id AS individual_id, v_organization_id AS organization_id;
    END;
    `,
  );
};
