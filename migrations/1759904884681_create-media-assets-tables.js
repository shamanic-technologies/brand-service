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
  // Create supabase_storage table - technical layer for Supabase Storage sync
  pgm.createTable('supabase_storage', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    supabase_url: { type: 'text', notNull: true, unique: true },
    storage_bucket: { type: 'text', notNull: true },
    storage_path: { type: 'text', notNull: true },
    file_name: { type: 'text', notNull: true },
    file_size: { type: 'bigint' }, // size in bytes
    mime_type: { type: 'text' },
    file_extension: { type: 'text' },
    width: { type: 'integer' }, // for images/videos
    height: { type: 'integer' }, // for images/videos
    duration: { type: 'numeric' }, // for videos/audio in seconds
    metadata: { type: 'jsonb' }, // additional Supabase metadata
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

  // Create index on storage_bucket and storage_path for faster lookups
  pgm.createIndex('supabase_storage', ['storage_bucket', 'storage_path']);

  // Create media_assets table - business layer for all media types
  pgm.createTable('media_assets', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    client_organization_id: { type: 'text', notNull: true }, // not FK - comes from different database
    asset_type: {
      type: 'text',
      notNull: true,
      check: "asset_type IN ('uploaded_file', 'youtube', 'spotify', 'vimeo', 'soundcloud', 'other')",
    },
    asset_url: { type: 'text', notNull: true }, // main URL (Supabase, YouTube, etc.)
    supabase_storage_id: {
      type: 'uuid',
      references: '"supabase_storage"',
      onDelete: 'SET NULL',
    }, // nullable FK - only for uploaded_file type
    optimized_url: { type: 'text' }, // optimized version URL (mainly for uploaded files)
    title: { type: 'text' },
    caption: { type: 'text' }, // description for journalists
    alt_text: { type: 'text' }, // for accessibility and SEO
    is_shareable: { type: 'boolean', notNull: true, default: true }, // can be used in media kit
    metadata: { type: 'jsonb' }, // type-specific data (YouTube video ID, Spotify track ID, etc.)
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

  // Create indexes for common queries
  pgm.createIndex('media_assets', 'client_organization_id');
  pgm.createIndex('media_assets', 'asset_type');
  pgm.createIndex('media_assets', ['client_organization_id', 'is_shareable']);
  pgm.createIndex('media_assets', 'supabase_storage_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop in reverse order due to FK constraint
  pgm.dropTable('media_assets');
  pgm.dropTable('supabase_storage');
};
