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
  // Add md5_hash column to supabase_storage for duplicate detection
  pgm.addColumn('supabase_storage', {
    md5_hash: {
      type: 'text',
      notNull: false,
    },
  });

  // Create index on md5_hash for fast duplicate detection
  pgm.createIndex('supabase_storage', 'md5_hash');

  // Add comment to explain the purpose
  pgm.sql(`
    COMMENT ON COLUMN supabase_storage.md5_hash IS 'MD5 hash of file content for duplicate detection across organizations';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the index first
  pgm.dropIndex('supabase_storage', 'md5_hash');
  
  // Drop the column
  pgm.dropColumn('supabase_storage', 'md5_hash');
};
