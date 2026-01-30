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
  // 1. Add 'generating' to the status enum
  pgm.sql(`
    ALTER TYPE organization_individual_thesis_status ADD VALUE IF NOT EXISTS 'generating';
  `);

  // 2. Add generating_started_at column
  pgm.addColumn('organizations_aied_thesis', {
    generating_started_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Timestamp when thesis generation started for this contrarian level',
    },
  });

  // 3. Add index on generating_started_at for queries
  pgm.createIndex('organizations_aied_thesis', 'generating_started_at');

  // Add comment to table
  pgm.sql(`
    COMMENT ON TABLE organizations_aied_thesis IS 'Stores AI-generated thesis statements for organizations at different contrarian levels. Status can be: pending (default), generating (during AI generation), validated (approved), or denied (rejected).';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop index
  pgm.dropIndex('organizations_aied_thesis', 'generating_started_at');

  // Drop column
  pgm.dropColumn('organizations_aied_thesis', 'generating_started_at');

  // Note: Cannot remove enum value once added in PostgreSQL
  // The 'generating' value will remain in the enum type
};
