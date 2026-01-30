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
  pgm.dropFunction('upsert_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_organization_name', type: 'text', mode: 'IN' },
    { name: 'p_organization_url', type: 'text', mode: 'IN' },
  ], {
    ifExists: true,
  });

  // Create updated function with linkedin URL support
  pgm.createFunction(
    'upsert_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_organization_name', type: 'text', mode: 'IN', default: null },
      { name: 'p_organization_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_organization_linkedin_url', type: 'text', mode: 'IN', default: null },
    ],
    {
      returns: 'uuid',
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
      RETURNING id;
    `
  );

  // Update comment
  pgm.sql(`
    COMMENT ON FUNCTION upsert_organization IS 'Upserts an organization. If name/url/linkedin_url are provided, they are updated. If NULL, existing values are preserved. Domain is auto-extracted from URL via trigger.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Restore old function
  pgm.dropFunction('upsert_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_organization_name', type: 'text', mode: 'IN' },
    { name: 'p_organization_url', type: 'text', mode: 'IN' },
    { name: 'p_organization_linkedin_url', type: 'text', mode: 'IN' },
  ]);

  pgm.createFunction(
    'upsert_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_organization_name', type: 'text', mode: 'IN', default: null },
      { name: 'p_organization_url', type: 'text', mode: 'IN', default: null },
    ],
    {
      returns: 'uuid',
      language: 'sql',
      replace: true,
    },
    `
      INSERT INTO organizations (external_organization_id, name, url, created_at, updated_at)
      VALUES (p_external_organization_id, p_organization_name, p_organization_url, NOW(), NOW())
      ON CONFLICT (external_organization_id) 
      DO UPDATE SET 
        name = COALESCE(EXCLUDED.name, organizations.name),
        url = COALESCE(EXCLUDED.url, organizations.url),
        updated_at = NOW()
      RETURNING id;
    `
  );
};
