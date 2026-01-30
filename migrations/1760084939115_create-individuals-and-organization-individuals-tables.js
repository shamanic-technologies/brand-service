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
  // Create individuals table
  pgm.createTable('individuals', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    first_name: {
      type: 'text',
      notNull: false,
    },
    last_name: {
      type: 'text',
      notNull: false,
    },
    linkedin_url: {
      type: 'text',
      notNull: false,
      unique: true,
    },
    personal_website_url: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create index on linkedin_url for fast lookups
  pgm.createIndex('individuals', 'linkedin_url');

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE individuals IS 'Stores information about individuals (people) who are associated with organizations';
    COMMENT ON COLUMN individuals.linkedin_url IS 'LinkedIn profile URL - used as unique identifier';
  `);

  // Create organization_individuals junction table
  pgm.createTable('organization_individuals', {
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: '"organizations"',
      onDelete: 'CASCADE',
    },
    individual_id: {
      type: 'uuid',
      notNull: true,
      references: '"individuals"',
      onDelete: 'CASCADE',
    },
    organization_role: {
      type: 'text',
      notNull: false,
    },
    joined_organization_at: {
      type: 'timestamp with time zone',
      notNull: false,
    },
    belonging_confidence_level: {
      type: 'text',
      notNull: false,
    },
    belonging_confidence_rationale: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create composite primary key
  pgm.addConstraint('organization_individuals', 'organization_individuals_pkey', {
    primaryKey: ['organization_id', 'individual_id'],
  });

  // Create indexes for foreign keys
  pgm.createIndex('organization_individuals', 'organization_id');
  pgm.createIndex('organization_individuals', 'individual_id');

  // Add comments
  pgm.sql(`
    COMMENT ON TABLE organization_individuals IS 'Junction table linking individuals to organizations with role and confidence information';
    COMMENT ON COLUMN organization_individuals.organization_role IS 'Role of the individual in the organization (e.g., Founder, Co-Founder and CTO, etc.)';
    COMMENT ON COLUMN organization_individuals.belonging_confidence_level IS 'Confidence level: "Found online" or "Guessed"';
    COMMENT ON COLUMN organization_individuals.belonging_confidence_rationale IS 'Rationale explaining the confidence level';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop tables in reverse order (junction table first)
  pgm.dropTable('organization_individuals');
  pgm.dropTable('individuals');
};
