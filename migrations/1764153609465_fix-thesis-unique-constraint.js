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
  // Drop the old unique constraint
  pgm.dropConstraint('organizations_individuals_aied_thesis', 'unique_org_individual_level');

  // Create new unique constraint including quote_html
  pgm.createConstraint(
    'organizations_individuals_aied_thesis',
    'unique_org_individual_level_quote',
    'UNIQUE(organization_id, individual_id, contrarian_level, quote_html)'
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the new constraint
  pgm.dropConstraint('organizations_individuals_aied_thesis', 'unique_org_individual_level_quote');

  // Recreate the old constraint
  pgm.createConstraint(
    'organizations_individuals_aied_thesis',
    'unique_org_individual_level',
    'UNIQUE(organization_id, individual_id, contrarian_level)'
  );
};
