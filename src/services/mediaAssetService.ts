import { eq, and, or, sql } from 'drizzle-orm';
import { db, mediaAssets, supabaseStorage } from '../db';

/**
 * Retrieves all media assets for a given brand ID.
 * Joins with supabase_storage to include full file details when available.
 */
export const getMediaAssetsByOrganizationId = async (brandId: string) => {
  const results = await db
    .select({
      id: mediaAssets.id,
      brand_id: mediaAssets.brandId,
      asset_type: mediaAssets.assetType,
      asset_url: mediaAssets.assetUrl,
      optimized_url: mediaAssets.optimizedUrl,
      caption: mediaAssets.caption,
      alt_text: mediaAssets.altText,
      is_shareable: mediaAssets.isShareable,
      asset_metadata: mediaAssets.metadata,
      created_at: mediaAssets.createdAt,
      updated_at: mediaAssets.updatedAt,
      storage_id: supabaseStorage.id,
      supabase_url: supabaseStorage.supabaseUrl,
      storage_bucket: supabaseStorage.storageBucket,
      storage_path: supabaseStorage.storagePath,
      file_name: supabaseStorage.fileName,
      file_size: supabaseStorage.fileSize,
      mime_type: supabaseStorage.mimeType,
      file_extension: supabaseStorage.fileExtension,
      width: supabaseStorage.width,
      height: supabaseStorage.height,
      duration: supabaseStorage.duration,
      storage_metadata: supabaseStorage.metadata,
    })
    .from(mediaAssets)
    .leftJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
    .where(eq(mediaAssets.brandId, brandId))
    .orderBy(mediaAssets.createdAt);

  return results;
};

/**
 * Updates the is_shareable field of a media asset.
 */
export const updateMediaAssetShareable = async (
  assetId: string,
  brandId: string,
  isShareable: boolean
) => {
  const result = await db
    .update(mediaAssets)
    .set({ isShareable, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.brandId, brandId)))
    .returning();

  if (result.length === 0) {
    throw new Error('Media asset not found or unauthorized');
  }

  return result[0];
};

/**
 * Updates the caption of a media asset.
 */
export const updateMediaAsset = async (
  assetId: string,
  brandId: string,
  caption?: string
) => {
  if (caption === undefined) {
    throw new Error('Caption is required to update');
  }

  const result = await db
    .update(mediaAssets)
    .set({ caption, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.brandId, brandId)))
    .returning();

  if (result.length === 0) {
    throw new Error('Media asset not found or unauthorized');
  }

  return result[0];
};

/**
 * Updates a media asset by URL (finds it by asset_url or optimized_url).
 */
export const updateMediaAssetByUrl = async (
  url: string,
  brandId: string,
  caption?: string,
  altText?: string
) => {
  if (caption === undefined && altText === undefined) {
    throw new Error('At least one field (caption or alt_text) is required to update');
  }

  const updateData: { caption?: string; altText?: string; updatedAt: any } = {
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };

  if (caption !== undefined) updateData.caption = caption;
  if (altText !== undefined) updateData.altText = altText;

  const result = await db
    .update(mediaAssets)
    .set(updateData)
    .where(
      and(
        or(eq(mediaAssets.assetUrl, url), eq(mediaAssets.optimizedUrl, url)),
        eq(mediaAssets.brandId, brandId)
      )
    )
    .returning();

  if (result.length === 0) {
    throw new Error('Media asset not found or unauthorized');
  }

  return result[0];
};
