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
  // Add status column to organizations table
  pgm.addColumn('organizations', {
    status: {
      type: 'text',
      notNull: false,
      default: null,
      comment: 'Current status of organization processing: generating or null',
    },
  });

  // Add check constraint to ensure status can only be 'generating' or NULL
  pgm.addConstraint('organizations', 'organizations_status_check', {
    check: "status IS NULL OR status = 'generating'",
  });

  // Add generating_started_at column to organizations table
  pgm.addColumn('organizations', {
    generating_started_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
      comment: 'Timestamp when the generation process started',
    },
  });

  // Create index on status for efficient filtering
  pgm.createIndex('organizations', 'status', {
    where: 'status IS NOT NULL',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the index
  pgm.dropIndex('organizations', 'status', {
    where: 'status IS NOT NULL',
  });

  // Drop the generating_started_at column
  pgm.dropColumn('organizations', 'generating_started_at');

  // Drop the check constraint
  pgm.dropConstraint('organizations', 'organizations_status_check');

  // Drop the status column
  pgm.dropColumn('organizations', 'status');
};
