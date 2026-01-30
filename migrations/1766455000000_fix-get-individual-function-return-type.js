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
  // Drop the existing function
  pgm.dropFunction('get_individual_by_name_and_organization', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_first_name', type: 'text' },
    { name: 'p_last_name', type: 'text' },
  ]);

  // Recreate with correct return type (belonging_confidence_level_enum instead of text)
  pgm.createFunction(
    'get_individual_by_name_and_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_first_name', type: 'text', mode: 'IN' },
      { name: 'p_last_name', type: 'text', mode: 'IN' },
    ],
    {
      returns: `TABLE(
        individual_id uuid,
        first_name text,
        last_name text,
        linkedin_url text,
        personal_website_url text,
        individual_created_at timestamptz,
        individual_updated_at timestamptz,
        organization_id uuid,
        organization_role text,
        joined_organization_at timestamptz,
        belonging_confidence_level belonging_confidence_level_enum,
        belonging_confidence_rationale text,
        relation_created_at timestamptz,
        relation_updated_at timestamptz
      )`,
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_organization_id uuid;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- If organization not found, return empty result
      IF v_organization_id IS NULL THEN
        RETURN;
      END IF;

      -- Return the individual and their relationship with the organization
      RETURN QUERY
      SELECT 
        i.id AS individual_id,
        i.first_name,
        i.last_name,
        i.linkedin_url,
        i.personal_website_url,
        i.created_at AS individual_created_at,
        i.updated_at AS individual_updated_at,
        oi.organization_id,
        oi.organization_role,
        oi.joined_organization_at,
        oi.belonging_confidence_level,
        oi.belonging_confidence_rationale,
        oi.created_at AS relation_created_at,
        oi.updated_at AS relation_updated_at
      FROM individuals i
      JOIN organization_individuals oi ON i.id = oi.individual_id
      WHERE i.first_name = p_first_name 
        AND i.last_name = p_last_name 
        AND oi.organization_id = v_organization_id;
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
  // Drop the fixed function
  pgm.dropFunction('get_individual_by_name_and_organization', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_first_name', type: 'text' },
    { name: 'p_last_name', type: 'text' },
  ]);

  // Recreate original (broken) version
  pgm.createFunction(
    'get_individual_by_name_and_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_first_name', type: 'text', mode: 'IN' },
      { name: 'p_last_name', type: 'text', mode: 'IN' },
    ],
    {
      returns: `TABLE(
        individual_id uuid,
        first_name text,
        last_name text,
        linkedin_url text,
        personal_website_url text,
        individual_created_at timestamptz,
        individual_updated_at timestamptz,
        organization_id uuid,
        organization_role text,
        joined_organization_at timestamptz,
        belonging_confidence_level text,
        belonging_confidence_rationale text,
        relation_created_at timestamptz,
        relation_updated_at timestamptz
      )`,
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_organization_id uuid;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- If organization not found, return empty result
      IF v_organization_id IS NULL THEN
        RETURN;
      END IF;

      -- Return the individual and their relationship with the organization
      RETURN QUERY
      SELECT 
        i.id AS individual_id,
        i.first_name,
        i.last_name,
        i.linkedin_url,
        i.personal_website_url,
        i.created_at AS individual_created_at,
        i.updated_at AS individual_updated_at,
        oi.organization_id,
        oi.organization_role,
        oi.joined_organization_at,
        oi.belonging_confidence_level,
        oi.belonging_confidence_rationale,
        oi.created_at AS relation_created_at,
        oi.updated_at AS relation_updated_at
      FROM individuals i
      JOIN organization_individuals oi ON i.id = oi.individual_id
      WHERE i.first_name = p_first_name 
        AND i.last_name = p_last_name 
        AND oi.organization_id = v_organization_id;
    END;
    `,
  );
};

