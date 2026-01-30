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
  // Drop the existing functions first (required before modifying return type)
  pgm.dropFunction('get_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ], {
    ifExists: true,
  });
  
  pgm.dropFunction('get_non_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ], {
    ifExists: true,
  });

  // Drop the tags index first
  pgm.dropIndex('media_assets', 'tags', {
    method: 'gin',
    ifExists: true,
  });

  // Drop the tag check constraint
  pgm.dropConstraint('media_assets', 'media_assets_tags_check', {
    ifExists: true,
  });

  // Drop the columns
  pgm.dropColumn('media_assets', 'tags');
  pgm.dropColumn('media_assets', 'media_kit_relevance_score');
  pgm.dropColumn('media_assets', 'pitch_relevance_score');

  // Recreate the get_shareable_media_assets_by_client_org_id function
  pgm.createFunction(
    'get_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.client_organization_id,
        ma.asset_type,
        ma.asset_url,
        ma.optimized_url,
        ma.title,
        ma.caption,
        ma.alt_text,
        ma.is_shareable,
        ma.metadata AS asset_metadata,
        ma.created_at,
        ma.updated_at,
        ss.id AS storage_id,
        ss.supabase_url,
        ss.storage_bucket,
        ss.storage_path,
        ss.file_name,
        ss.file_size,
        ss.mime_type,
        ss.file_extension,
        ss.width,
        ss.height,
        ss.duration,
        ss.metadata AS storage_metadata
      FROM
        media_assets AS ma
      LEFT JOIN
        supabase_storage AS ss
      ON
        ma.supabase_storage_id = ss.id
      WHERE
        ma.client_organization_id = client_org_id
        AND ma.is_shareable = true
      ORDER BY
        ma.created_at DESC;
    `
  );

  // Recreate the get_non_shareable_media_assets_by_client_org_id function
  pgm.createFunction(
    'get_non_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.client_organization_id,
        ma.asset_type,
        ma.asset_url,
        ma.optimized_url,
        ma.title,
        ma.caption,
        ma.alt_text,
        ma.is_shareable,
        ma.metadata AS asset_metadata,
        ma.created_at,
        ma.updated_at,
        ss.id AS storage_id,
        ss.supabase_url,
        ss.storage_bucket,
        ss.storage_path,
        ss.file_name,
        ss.file_size,
        ss.mime_type,
        ss.file_extension,
        ss.width,
        ss.height,
        ss.duration,
        ss.metadata AS storage_metadata
      FROM
        media_assets AS ma
      LEFT JOIN
        supabase_storage AS ss
      ON
        ma.supabase_storage_id = ss.id
      WHERE
        ma.client_organization_id = client_org_id
        AND ma.is_shareable = false
      ORDER BY
        ma.created_at DESC;
    `
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Re-add the columns
  pgm.addColumn('media_assets', {
    tags: {
      type: 'text[]',
      default: '{}',
    },
  });

  pgm.addColumn('media_assets', {
    media_kit_relevance_score: {
      type: 'integer',
      check: 'media_kit_relevance_score >= 0 AND media_kit_relevance_score <= 100',
    },
  });

  pgm.addColumn('media_assets', {
    pitch_relevance_score: {
      type: 'integer',
      check: 'pitch_relevance_score >= 0 AND pitch_relevance_score <= 100',
    },
  });

  // Re-add the check constraint
  pgm.addConstraint('media_assets', 'media_assets_tags_check', {
    check: `
      tags <@ ARRAY[
        'product', 'service', 'organization_logo', 'customer_logo', 
        'demo', 'credentials', 'individual', 'people', 
        'venue', 'launch', 'other'
      ]::text[]
    `,
  });

  // Re-add the index
  pgm.createIndex('media_assets', 'tags', {
    method: 'gin',
  });

  // Restore the old functions with the columns
  pgm.createFunction(
    'get_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, caption text, alt_text text, is_shareable boolean, tags text[], media_kit_relevance_score integer, pitch_relevance_score integer, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.client_organization_id,
        ma.asset_type,
        ma.asset_url,
        ma.optimized_url,
        ma.title,
        ma.caption,
        ma.alt_text,
        ma.is_shareable,
        ma.tags,
        ma.media_kit_relevance_score,
        ma.pitch_relevance_score,
        ma.metadata AS asset_metadata,
        ma.created_at,
        ma.updated_at,
        ss.id AS storage_id,
        ss.supabase_url,
        ss.storage_bucket,
        ss.storage_path,
        ss.file_name,
        ss.file_size,
        ss.mime_type,
        ss.file_extension,
        ss.width,
        ss.height,
        ss.duration,
        ss.metadata AS storage_metadata
      FROM
        media_assets AS ma
      LEFT JOIN
        supabase_storage AS ss
      ON
        ma.supabase_storage_id = ss.id
      WHERE
        ma.client_organization_id = client_org_id
        AND ma.is_shareable = true
      ORDER BY
        ma.created_at DESC;
    `
  );

  pgm.createFunction(
    'get_non_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, caption text, alt_text text, is_shareable boolean, tags text[], media_kit_relevance_score integer, pitch_relevance_score integer, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.client_organization_id,
        ma.asset_type,
        ma.asset_url,
        ma.optimized_url,
        ma.title,
        ma.caption,
        ma.alt_text,
        ma.is_shareable,
        ma.tags,
        ma.media_kit_relevance_score,
        ma.pitch_relevance_score,
        ma.metadata AS asset_metadata,
        ma.created_at,
        ma.updated_at,
        ss.id AS storage_id,
        ss.supabase_url,
        ss.storage_bucket,
        ss.storage_path,
        ss.file_name,
        ss.file_size,
        ss.mime_type,
        ss.file_extension,
        ss.width,
        ss.height,
        ss.duration,
        ss.metadata AS storage_metadata
      FROM
        media_assets AS ma
      LEFT JOIN
        supabase_storage AS ss
      ON
        ma.supabase_storage_id = ss.id
      WHERE
        ma.client_organization_id = client_org_id
        AND ma.is_shareable = false
      ORDER BY
        ma.created_at DESC;
    `
  );
};
