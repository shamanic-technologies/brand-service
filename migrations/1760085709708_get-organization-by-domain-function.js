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
  // Create function to get organization by domain
  pgm.createFunction(
    'get_organization_by_domain',
    [{ name: 'p_domain', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, name text, url text, organization_linkedin_url text, domain text, external_organization_id text, created_at timestamptz, updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        id,
        name,
        url,
        organization_linkedin_url,
        domain,
        external_organization_id,
        created_at,
        updated_at
      FROM
        organizations
      WHERE
        domain = p_domain
      LIMIT 1;
    `
  );

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION get_organization_by_domain IS 'Retrieves an organization by its domain (e.g., "unrth.com"). Returns NULL if not found.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_by_domain', [
    { name: 'p_domain', type: 'text', mode: 'IN' },
  ]);
};
