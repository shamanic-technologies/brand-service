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
  // Create function to get all individuals linked to an organization
  pgm.createFunction(
    'get_organization_individuals',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(individual_id uuid, first_name text, last_name text, linkedin_url text, personal_website_url text, organization_role text, joined_organization_at timestamptz, belonging_confidence_level text, belonging_confidence_rationale text, individual_created_at timestamptz, individual_updated_at timestamptz, link_created_at timestamptz, link_updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        i.id AS individual_id,
        i.first_name,
        i.last_name,
        i.linkedin_url,
        i.personal_website_url,
        oi.organization_role,
        oi.joined_organization_at,
        oi.belonging_confidence_level,
        oi.belonging_confidence_rationale,
        i.created_at AS individual_created_at,
        i.updated_at AS individual_updated_at,
        oi.created_at AS link_created_at,
        oi.updated_at AS link_updated_at
      FROM
        organizations AS org
      INNER JOIN
        organization_individuals AS oi ON org.id = oi.organization_id
      INNER JOIN
        individuals AS i ON oi.individual_id = i.id
      WHERE
        org.external_organization_id = p_external_organization_id
      ORDER BY
        oi.created_at DESC;
    `
  );

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION get_organization_individuals IS 'Retrieves all individuals linked to an organization identified by external_organization_id, with their role and confidence information.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_individuals', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
  ]);
};
