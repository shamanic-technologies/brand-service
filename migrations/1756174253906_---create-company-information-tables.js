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
  pgm.createTable('organizations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: { type: 'text', notNull: true },
    url: { type: 'text', notNull: true, unique: true },
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

  pgm.createTable('webpages', {
    id: { type: 'text', primaryKey: true }, // URL of the webpage
    webpage_url: { type: 'text', notNull: true, unique: true },
    webpage_title: { type: 'text' },
    webpage_content: { type: 'text' },
    metadata_favicon: { type: 'text' },
    metadata_language: { type: 'text' },
    metadata_description: { type: 'text' },
    metadata_title: { type: 'text' },
    metadata_category: { type: 'text' },
    metadata_twitter_site: { type: 'text' },
    metadata_twitter_creator: { type: 'text' },
    metadata_twitter_description: { type: 'text' },
    metadata_theme_color: { type: 'text' },
    metadata_og_locale: { type: 'text' },
    metadata_og_country_name: { type: 'text' },
    metadata_og_video: { type: 'text' },
    metadata_og_video_type: { type: 'text' },
    metadata_keywords: { type: 'text' },
    metadata_og_image: { type: 'text' },
    metadata_publisher: { type: 'text' },
    metadata_og_image_type: { type: 'text' },
    metadata_creator: { type: 'text' },
    metadata_author: { type: 'text' },
    metadata_og_image_alt: { type: 'text' },
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

  pgm.createTable('organization_webpages', {
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: '"organizations"',
      onDelete: 'cascade',
    },
    webpage_id: {
      type: 'text',
      notNull: true,
      references: '"webpages"',
      onDelete: 'cascade',
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
  // Add a composite primary key
  pgm.addConstraint('organization_webpages', 'organization_webpages_pkey', {
    primaryKey: ['organization_id', 'webpage_id'],
  });


  pgm.createTable('organization_relations', {
    source_organization_id: {
      type: 'uuid',
      notNull: true,
      references: '"organizations"',
      onDelete: 'cascade',
    },
    target_organization_id: {
      type: 'uuid',
      notNull: true,
      references: '"organizations"',
      onDelete: 'cascade',
    },
    relation_type: { type: 'text' },
    relation_confidence_level: { type: 'text' },
    relation_confidence_rationale: { type: 'text' },
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
  // Add a composite primary key
  pgm.addConstraint(
    'organization_relations',
    'organization_relations_pkey',
    {
      primaryKey: ['source_organization_id', 'target_organization_id'],
    },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('organization_relations');
  pgm.dropTable('organization_webpages');
  pgm.dropTable('webpages');
  pgm.dropTable('organizations');
};
