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
  pgm.addColumn('organizations', {
    logo_url: {
      type: 'text',
      notNull: false,
      comment: 'URL to the organization logo image',
    },
  });

  // Create index for queries filtering by logo_url existence
  pgm.createIndex('organizations', 'logo_url', {
    name: 'organizations_logo_url_index',
    where: 'logo_url IS NOT NULL',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('organizations', 'logo_url', {
    name: 'organizations_logo_url_index',
  });
  
  pgm.dropColumn('organizations', 'logo_url');
};
