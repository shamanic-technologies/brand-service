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
  // Add unique constraint on individual_id to ensure one PDL enrichment per individual
  pgm.addConstraint('individuals_pdl_enrichment', 'individuals_pdl_enrichment_individual_id_unique', {
    unique: 'individual_id',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint('individuals_pdl_enrichment', 'individuals_pdl_enrichment_individual_id_unique');
};
