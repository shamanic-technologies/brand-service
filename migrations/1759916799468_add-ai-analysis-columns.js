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
  // Add tags column (array of text with check constraint for allowed values)
  pgm.addColumn('media_assets', {
    tags: {
      type: 'text[]',
      default: '{}',
    },
  });

  // Add check constraint to validate tag values
  pgm.addConstraint('media_assets', 'media_assets_tags_check', {
    check: `
      tags <@ ARRAY[
        'product', 'service', 'organization_logo', 'customer_logo', 
        'demo', 'credentials', 'individual', 'people', 
        'venue', 'launch', 'other'
      ]::text[]
    `,
  });

  // Add media_kit_relevance_score (0-100)
  pgm.addColumn('media_assets', {
    media_kit_relevance_score: {
      type: 'integer',
      check: 'media_kit_relevance_score >= 0 AND media_kit_relevance_score <= 100',
    },
  });

  // Add pitch_relevance_score (0-100)
  pgm.addColumn('media_assets', {
    pitch_relevance_score: {
      type: 'integer',
      check: 'pitch_relevance_score >= 0 AND pitch_relevance_score <= 100',
    },
  });

  // Add index on tags for faster filtering
  pgm.createIndex('media_assets', 'tags', {
    method: 'gin',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('media_assets', 'tags');
  pgm.dropColumn('media_assets', 'pitch_relevance_score');
  pgm.dropColumn('media_assets', 'media_kit_relevance_score');
  pgm.dropConstraint('media_assets', 'media_assets_tags_check');
  pgm.dropColumn('media_assets', 'tags');
};
