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

  // Rename the title column to caption
  pgm.renameColumn('media_assets', 'title', 'caption');

  // Update the column comment to reflect new purpose
  pgm.sql(`
    COMMENT ON COLUMN media_assets.caption IS 'AI-generated caption that journalists will see under the image in the media kit. Example: "Keynote at TechCrunch Disrupt 2024" or "Amanda Leon, Founder of UNRTH"';
  `);

  // Recreate the get_shareable_media_assets_by_client_org_id function with caption
  pgm.createFunction(
    'get_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
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

  // Recreate the get_non_shareable_media_assets_by_client_org_id function with caption
  pgm.createFunction(
    'get_non_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
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
  // Drop functions
  pgm.dropFunction('get_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ]);
  
  pgm.dropFunction('get_non_shareable_media_assets_by_client_org_id', [
    { name: 'client_org_id', type: 'text', mode: 'IN' },
  ]);

  // Rename back to title
  pgm.renameColumn('media_assets', 'caption', 'title');

  // Restore old comment
  pgm.sql(`
    COMMENT ON COLUMN media_assets.title IS 'AI-generated title for the media asset. Original filename is in supabase_storage.file_name';
  `);

  // Restore old functions with title
  pgm.createFunction(
    'get_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
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

  pgm.createFunction(
    'get_non_shareable_media_assets_by_client_org_id',
    [{ name: 'client_org_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, client_organization_id text, asset_type text, asset_url text, optimized_url text, title text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
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
