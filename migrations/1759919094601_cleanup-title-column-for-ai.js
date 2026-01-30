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
  // Clear the title column for all existing media assets
  // The title will now be AI-generated, not the filename
  // The original filename is available in supabase_storage.file_name
  pgm.sql(`
    UPDATE media_assets 
    SET title = NULL 
    WHERE title IS NOT NULL;
  `);

  // Add comment to document the new purpose
  pgm.sql(`
    COMMENT ON COLUMN media_assets.title IS 'AI-generated title for the media asset. Original filename is in supabase_storage.file_name';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Restore titles from file_name in supabase_storage
  pgm.sql(`
    UPDATE media_assets ma
    SET title = ss.file_name
    FROM supabase_storage ss
    WHERE ma.supabase_storage_id = ss.id
      AND ma.title IS NULL;
  `);

  // Remove comment
  pgm.sql(`
    COMMENT ON COLUMN media_assets.title IS NULL;
  `);
};
