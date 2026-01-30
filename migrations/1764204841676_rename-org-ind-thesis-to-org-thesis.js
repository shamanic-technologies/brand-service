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
  // 1. Rename table
  pgm.renameTable('organizations_individuals_aied_thesis', 'organizations_aied_thesis');

  // 2. Drop old unique constraint (using new table name as target)
  // Note: The constraint name 'unique_org_individual_level_quote' persists after table rename
  pgm.dropConstraint('organizations_aied_thesis', 'unique_org_individual_level_quote');

  // 3. Drop individual_id column
  pgm.dropColumn('organizations_aied_thesis', 'individual_id');

  // 4. Rename quote_html to thesis_html
  pgm.renameColumn('organizations_aied_thesis', 'quote_html', 'thesis_html');

  // 5. Add thesis_supporting_evidence_html column
  pgm.addColumn('organizations_aied_thesis', {
    thesis_supporting_evidence_html: {
      type: 'text',
      notNull: false,
      comment: 'HTML content for supporting evidence of the thesis',
    },
  });

  // 6. Ensure contrarian_level is not null
  pgm.alterColumn('organizations_aied_thesis', 'contrarian_level', {
    notNull: true,
  });

  // 7. Create new unique constraint for the new schema
  // Since individual_id is gone, uniqueness is likely per org + level + thesis content
  pgm.createConstraint(
    'organizations_aied_thesis',
    'unique_org_level_thesis',
    'UNIQUE(organization_id, contrarian_level, thesis_html)'
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // 1. Drop new unique constraint
  pgm.dropConstraint('organizations_aied_thesis', 'unique_org_level_thesis');

  // 2. Remove thesis_supporting_evidence_html
  pgm.dropColumn('organizations_aied_thesis', 'thesis_supporting_evidence_html');

  // 3. Rename thesis_html back to quote_html
  pgm.renameColumn('organizations_aied_thesis', 'thesis_html', 'quote_html');

  // 4. Add individual_id back (nullable since we lost the data)
  pgm.addColumn('organizations_aied_thesis', {
    individual_id: {
      type: 'uuid',
      notNull: false, // Cannot be null constraint without data
      references: 'individuals(id)',
      onDelete: 'CASCADE',
    },
  });

  // 5. Rename table back
  pgm.renameTable('organizations_aied_thesis', 'organizations_individuals_aied_thesis');

  // Note: We cannot easily restore the old unique constraint because individual_id is now null for all rows
};
