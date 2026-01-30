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
  // Make name and url nullable
  pgm.alterColumn('organizations', 'name', {
    notNull: false,
  });

  // Drop unique constraint on url (since NULL values can be duplicated)
  pgm.dropConstraint('organizations', 'organizations_url_key', {
    ifExists: true,
  });

  pgm.alterColumn('organizations', 'url', {
    notNull: false,
  });

  // Recreate unique constraint on url but only for non-NULL values
  pgm.sql(`
    CREATE UNIQUE INDEX organizations_url_unique 
    ON organizations (url) 
    WHERE url IS NOT NULL;
  `);

  // Drop and recreate upsert_organization function to handle optional name/url
  pgm.dropFunction('upsert_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_organization_name', type: 'text', mode: 'IN' },
    { name: 'p_organization_url', type: 'text', mode: 'IN' },
  ], {
    ifExists: true,
  });

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

  pgm.sql(`
    COMMENT ON FUNCTION upsert_organization IS 'Upserts an organization. If name/url are provided, they are updated. If NULL, existing values are preserved. Auto-creates organization with just external_id if it does not exist.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the partial unique index
  pgm.dropIndex('organizations', 'url', {
    name: 'organizations_url_unique',
    ifExists: true,
  });

  // Restore NOT NULL constraints
  pgm.alterColumn('organizations', 'name', {
    notNull: true,
  });

  pgm.alterColumn('organizations', 'url', {
    notNull: true,
  });

  // Restore unique constraint on url
  pgm.addConstraint('organizations', 'organizations_url_key', {
    unique: 'url',
  });

  // Restore old upsert function
  pgm.dropFunction('upsert_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_organization_name', type: 'text', mode: 'IN' },
    { name: 'p_organization_url', type: 'text', mode: 'IN' },
  ]);

  pgm.createFunction(
    'upsert_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_organization_name', type: 'text', mode: 'IN' },
      { name: 'p_organization_url', type: 'text', mode: 'IN' },
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
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        updated_at = NOW()
      RETURNING id;
    `
  );
};
