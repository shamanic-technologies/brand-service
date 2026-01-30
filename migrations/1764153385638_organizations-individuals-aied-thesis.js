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
  // Create status enum type
  pgm.createType('organization_individual_thesis_status', ['pending', 'validated', 'denied']);

  // Create the organizations_individuals_aied_thesis table
  pgm.createTable('organizations_individuals_aied_thesis', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    individual_id: {
      type: 'uuid',
      notNull: true,
      references: 'individuals(id)',
      onDelete: 'CASCADE',
    },
    quote_html: {
      type: 'text',
      notNull: true,
    },
    contrarian_level: {
      type: 'integer',
      notNull: true,
      comment: 'Link to thesis contrarian level 1-10',
    },
    status: {
      type: 'organization_individual_thesis_status',
      notNull: true,
      default: 'pending',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create unique constraint to prevent duplicate thesis per organization/individual/level
  pgm.createConstraint(
    'organizations_individuals_aied_thesis',
    'unique_org_individual_level',
    'UNIQUE(organization_id, individual_id, contrarian_level)'
  );

  // Create indexes for common queries
  pgm.createIndex('organizations_individuals_aied_thesis', 'organization_id');
  pgm.createIndex('organizations_individuals_aied_thesis', 'individual_id');
  pgm.createIndex('organizations_individuals_aied_thesis', 'status');
  pgm.createIndex('organizations_individuals_aied_thesis', 'contrarian_level');

  // Create updated_at trigger
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.createTrigger(
    'organizations_individuals_aied_thesis',
    'update_organizations_individuals_aied_thesis_updated_at',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      function: 'update_updated_at_column',
      level: 'ROW',
    }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop table (cascade will handle trigger)
  pgm.dropTable('organizations_individuals_aied_thesis', { cascade: true });

  // Drop enum type
  pgm.dropType('organization_individual_thesis_status');

  // Note: We don't drop the update_updated_at_column function as it might be used by other tables
};
