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
  // Create function to get shareable media assets by client organization ID
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

  // Create function to get non-shareable media assets by client organization ID
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

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ]);
  pgm.dropFunction('get_non_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ]);
};
