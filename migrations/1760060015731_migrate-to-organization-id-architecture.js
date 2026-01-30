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
  // Step 1: Drop existing functions that depend on client_organization_id
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

  // Step 2: Add external_organization_id to organizations table
  pgm.addColumn('organizations', {
    external_organization_id: {
      type: 'text',
      notNull: true,
      unique: true,
      default: pgm.func("gen_random_uuid()::text"), // Temporary default for existing rows
    },
  });

  // Remove the temporary default after column is added
  pgm.alterColumn('organizations', 'external_organization_id', {
    default: null,
  });

  pgm.sql(`
    COMMENT ON COLUMN organizations.external_organization_id IS 'External ID from other services (e.g., press-funnel client_organization_id). Used as the public/external identifier.';
  `);

  // Step 3: Create upsert_organization function
  pgm.createFunction(
    'upsert_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_organization_name', type: 'text', mode: 'IN' },
      { name: 'p_organization_url', type: 'text', mode: 'IN' },
    ],
    {
      returns: 'uuid',
      language: 'sql',
      replace: true,
    },
    `
      INSERT INTO organizations (external_organization_id, name, url, created_at, updated_at)
      VALUES (p_external_organization_id, p_organization_name, p_organization_url, NOW(), NOW())
      ON CONFLICT (external_organization_id) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        updated_at = NOW()
      RETURNING id;
    `
  );

  // Step 4: Clean up all existing media assets (as requested - will be repopulated manually)
  pgm.sql('DELETE FROM media_assets;');
  pgm.sql('DELETE FROM supabase_storage;');

  // Step 5: Add organization_id column to media_assets (FK to organizations)
  pgm.addColumn('media_assets', {
    organization_id: {
      type: 'uuid',
      references: '"organizations"',
      onDelete: 'CASCADE',
    },
  });

  // Step 6: Drop the old client_organization_id column
  pgm.dropIndex('media_assets', 'client_organization_id', { ifExists: true });
  pgm.dropIndex('media_assets', ['client_organization_id', 'is_shareable'], { ifExists: true });
  pgm.dropColumn('media_assets', 'client_organization_id');

  // Step 7: Create new index on organization_id
  pgm.createIndex('media_assets', 'organization_id');
  pgm.createIndex('media_assets', ['organization_id', 'is_shareable']);

  // Step 8: Recreate functions with new signature (using organization_id)
  pgm.createFunction(
    'get_shareable_media_assets_by_organization_id',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, organization_id uuid, asset_type text, asset_url text, optimized_url text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.organization_id,
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
        ma.organization_id = p_organization_id
        AND ma.is_shareable = true
      ORDER BY
        ma.created_at DESC;
    `
  );

  pgm.createFunction(
    'get_non_shareable_media_assets_by_organization_id',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, organization_id uuid, asset_type text, asset_url text, optimized_url text, caption text, alt_text text, is_shareable boolean, asset_metadata jsonb, created_at timestamptz, updated_at timestamptz, storage_id uuid, supabase_url text, storage_bucket text, storage_path text, file_name text, file_size bigint, mime_type text, file_extension text, width integer, height integer, duration numeric, storage_metadata jsonb)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        ma.id,
        ma.organization_id,
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
        ma.organization_id = p_organization_id
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
  // Drop new functions
  pgm.dropFunction('get_shareable_media_assets_by_organization_id', [
    { name: 'p_organization_id', type: 'uuid', mode: 'IN' },
  ]);
  
  pgm.dropFunction('get_non_shareable_media_assets_by_organization_id', [
    { name: 'p_organization_id', type: 'uuid', mode: 'IN' },
  ]);

  pgm.dropFunction('upsert_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_organization_name', type: 'text', mode: 'IN' },
    { name: 'p_organization_url', type: 'text', mode: 'IN' },
  ]);

  // Restore old structure
  pgm.dropIndex('media_assets', 'organization_id', { ifExists: true });
  pgm.dropIndex('media_assets', ['organization_id', 'is_shareable'], { ifExists: true });
  
  pgm.addColumn('media_assets', {
    client_organization_id: {
      type: 'text',
      notNull: true,
      default: 'unknown',
    },
  });

  pgm.dropColumn('media_assets', 'organization_id');

  pgm.createIndex('media_assets', 'client_organization_id');
  pgm.createIndex('media_assets', ['client_organization_id', 'is_shareable']);

  // Remove external_organization_id from organizations
  pgm.dropColumn('organizations', 'external_organization_id');

  // Restore old functions
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
