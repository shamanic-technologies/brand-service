import pool from '../db';

/**
 * Retrieves all media assets for a given organization ID.
 * Joins with supabase_storage to include full file details when available.
 *
 * @param organizationId The organization internal UUID.
 * @returns A promise that resolves to an array of media assets with all associated fields.
 */
export const getMediaAssetsByOrganizationId = async (organizationId: string) => {
  const query = `
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
      -- Supabase storage fields (when available)
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
      ma.organization_id = $1
    ORDER BY
      ma.created_at ASC;
  `;

  try {
    const { rows } = await pool.query(query, [organizationId]);
    return rows;
  } catch (error) {
    console.error('Error fetching media assets:', error);
    throw error;
  }
};

/**
 * Updates the is_shareable field of a media asset.
 *
 * @param assetId The media asset ID.
 * @param organizationId The organization internal UUID (for security check).
 * @param isShareable The new value for is_shareable.
 * @returns A promise that resolves to the updated media asset.
 */
export const updateMediaAssetShareable = async (
  assetId: string,
  organizationId: string,
  isShareable: boolean
) => {
  const query = `
    UPDATE media_assets
    SET 
      is_shareable = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE 
      id = $2 
      AND organization_id = $3
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, [isShareable, assetId, organizationId]);
    
    if (rows.length === 0) {
      throw new Error('Media asset not found or unauthorized');
    }
    
    return rows[0];
  } catch (error) {
    console.error('Error updating media asset shareable status:', error);
    throw error;
  }
};

/**
 * Updates the caption of a media asset.
 *
 * @param assetId The media asset ID.
 * @param organizationId The organization internal UUID (for security check).
 * @param caption The new caption.
 * @returns A promise that resolves to the updated media asset.
 */
export const updateMediaAsset = async (
  assetId: string,
  organizationId: string,
  caption?: string
) => {
  if (caption === undefined) {
    throw new Error('Caption is required to update');
  }

  const query = `
    UPDATE media_assets
    SET 
      caption = $1,
      updated_at = CURRENT_TIMESTAMP
    WHERE 
      id = $2
      AND organization_id = $3
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, [caption, assetId, organizationId]);
    
    if (rows.length === 0) {
      throw new Error('Media asset not found or unauthorized');
    }
    
    return rows[0];
  } catch (error) {
    console.error('Error updating media asset:', error);
    throw error;
  }
};

/**
 * Updates a media asset by URL (finds it by asset_url or optimized_url).
 *
 * @param url The URL to find the media asset.
 * @param organizationId The organization internal UUID (for security check).
 * @param caption Optional new caption.
 * @param altText Optional new alt text.
 * @returns A promise that resolves to the updated media asset.
 */
export const updateMediaAssetByUrl = async (
  url: string,
  organizationId: string,
  caption?: string,
  altText?: string
) => {
  // Build the update fields dynamically
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (caption !== undefined) {
    updates.push(`caption = $${paramIndex++}`);
    values.push(caption);
  }

  if (altText !== undefined) {
    updates.push(`alt_text = $${paramIndex++}`);
    values.push(altText);
  }

  if (updates.length === 0) {
    throw new Error('At least one field (caption or alt_text) is required to update');
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  // Add URL and organization ID to values
  values.push(url, organizationId);

  const query = `
    UPDATE media_assets
    SET ${updates.join(', ')}
    WHERE 
      (asset_url = $${paramIndex} OR optimized_url = $${paramIndex})
      AND organization_id = $${paramIndex + 1}
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, values);
    
    if (rows.length === 0) {
      throw new Error('Media asset not found or unauthorized');
    }
    
    return rows[0];
  } catch (error) {
    console.error('Error updating media asset by URL:', error);
    throw error;
  }
};

