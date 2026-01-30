/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Add company information fields to organizations table
 * These fields will be populated by LLM from intake_forms or other sources
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Add location/headquarters
  pgm.addColumn('organizations', {
    location: {
      type: 'text',
      comment: 'Headquarters or main location of the organization',
    },
  });

  // Add bio/description
  pgm.addColumn('organizations', {
    bio: {
      type: 'text',
      comment: 'Short biography or description of the organization',
    },
  });

  // Add elevator pitch
  pgm.addColumn('organizations', {
    elevator_pitch: {
      type: 'text',
      comment: 'Concise elevator pitch describing the organization',
    },
  });

  // Add mission
  pgm.addColumn('organizations', {
    mission: {
      type: 'text',
      comment: 'Mission statement of the organization',
    },
  });

  // Add story
  pgm.addColumn('organizations', {
    story: {
      type: 'text',
      comment: 'How and why the organization was founded',
    },
  });

  // Add offerings
  pgm.addColumn('organizations', {
    offerings: {
      type: 'text',
      comment: 'Products and services offered by the organization',
    },
  });

  // Add problem_solution
  pgm.addColumn('organizations', {
    problem_solution: {
      type: 'text',
      comment: 'Problem the organization solves and how',
    },
  });

  // Add goals
  pgm.addColumn('organizations', {
    goals: {
      type: 'text',
      comment: 'Goals and objectives of the organization',
    },
  });

  // Add categories
  pgm.addColumn('organizations', {
    categories: {
      type: 'text',
      comment: 'Industry categories or sectors the organization belongs to',
    },
  });

  // Add founded_date
  pgm.addColumn('organizations', {
    founded_date: {
      type: 'date',
      comment: 'Date when the organization was founded',
    },
  });

  // Add contact information
  pgm.addColumn('organizations', {
    contact_name: {
      type: 'text',
      comment: 'Primary contact person name and title',
    },
  });

  pgm.addColumn('organizations', {
    contact_email: {
      type: 'text',
      comment: 'Primary contact email address',
    },
  });

  pgm.addColumn('organizations', {
    contact_phone: {
      type: 'text',
      comment: 'Primary contact phone number',
    },
  });

  // Add social media links
  pgm.addColumn('organizations', {
    social_media: {
      type: 'jsonb',
      comment: 'JSON object containing social media profiles (twitter, facebook, instagram, etc.)',
    },
  });

  // Add index on categories for filtering (using btree for text column)
  pgm.createIndex('organizations', 'categories', {
    name: 'idx_organizations_categories',
    where: 'categories IS NOT NULL',
  });

  // Add comment on table
  pgm.sql(`
    COMMENT ON TABLE organizations IS 'Core organizations table with company information fields populated by LLM from intake forms and other sources';
  `);
};

/**
 * Remove company information fields from organizations table
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Drop index first
  pgm.dropIndex('organizations', 'categories', {
    name: 'idx_organizations_categories',
    ifExists: true,
  });

  // Drop all added columns
  pgm.dropColumn('organizations', 'location', { ifExists: true });
  pgm.dropColumn('organizations', 'bio', { ifExists: true });
  pgm.dropColumn('organizations', 'elevator_pitch', { ifExists: true });
  pgm.dropColumn('organizations', 'mission', { ifExists: true });
  pgm.dropColumn('organizations', 'story', { ifExists: true });
  pgm.dropColumn('organizations', 'offerings', { ifExists: true });
  pgm.dropColumn('organizations', 'problem_solution', { ifExists: true });
  pgm.dropColumn('organizations', 'goals', { ifExists: true });
  pgm.dropColumn('organizations', 'categories', { ifExists: true });
  pgm.dropColumn('organizations', 'founded_date', { ifExists: true });
  pgm.dropColumn('organizations', 'contact_name', { ifExists: true });
  pgm.dropColumn('organizations', 'contact_email', { ifExists: true });
  pgm.dropColumn('organizations', 'contact_phone', { ifExists: true });
  pgm.dropColumn('organizations', 'social_media', { ifExists: true });
};
