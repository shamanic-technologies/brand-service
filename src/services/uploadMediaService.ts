import pool from '../db';
import { createClient } from '@supabase/supabase-js';
import { Readable } from 'stream';
import crypto from 'crypto';
import { getOrganizationIdByExternalId } from './organizationUpsertService';
import { 
  convertHeicToJpeg, 
  isHeicImage, 
  convertHeicExtension,
  getImageDimensions 
} from './imageConversionService';

// Initialize Supabase client
const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not configured');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
};

// Extract file extension from filename
const getFileExtension = (fileName: string): string => {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

// Calculate MD5 hash from buffer
const calculateMd5 = (buffer: Buffer): string => {
  return crypto.createHash('md5').update(buffer).digest('hex');
};

/**
 * Check if file with MD5 hash already exists in database for this organization
 */
const checkDuplicateByMd5 = async (
  md5Hash: string,
  organizationId: string
): Promise<{ mediaAssetId: string; url: string } | null> => {
  try {
    const query = `
      SELECT ma.id, ss.supabase_url
      FROM media_assets ma
      JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE ss.md5_hash = $1 AND ma.organization_id = $2
      LIMIT 1;
    `;
    
    const result = await pool.query(query, [md5Hash, organizationId]);
    
    if (result.rows.length > 0) {
      return {
        mediaAssetId: result.rows[0].id,
        url: result.rows[0].supabase_url,
      };
    }
    
    return null;
  } catch (error: any) {
    console.error('Error checking duplicate:', error);
    return null;
  }
};

interface UploadFileOptions {
  externalOrganizationId: string;
  file: Express.Multer.File;
  title?: string;
  caption?: string;
  altText?: string;
  isShareable?: boolean;
}

// Upload a single file directly to Supabase and save to database
export const uploadMediaFile = async (options: UploadFileOptions) => {
  const {
    externalOrganizationId,
    file,
    title,
    caption,
    altText,
    isShareable = true,
  } = options;

  const supabase = getSupabaseClient();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

  try {
    // Get or create organization and get internal ID (auto-creates if doesn't exist)
    const organizationId = await getOrganizationIdByExternalId(externalOrganizationId);

    const originalName = file.originalname;
    let fileBuffer = file.buffer;
    let mimeType = file.mimetype;
    let fileName = originalName;
    let fileExtension = getFileExtension(originalName);
    let dimensions: { width: number | null; height: number | null } = { width: null, height: null };

    // Convert HEIC/HEIF to JPEG
    if (isHeicImage(mimeType)) {
      console.log(`Converting HEIC image: ${originalName}`);
      const converted = await convertHeicToJpeg(fileBuffer);
      fileBuffer = converted.buffer;
      mimeType = 'image/jpeg';
      fileName = convertHeicExtension(originalName);
      fileExtension = 'jpg';
      dimensions = { width: converted.width, height: converted.height };
      console.log(`✓ Converted ${originalName} to JPEG (${converted.width}x${converted.height})`);
    } else if (mimeType.startsWith('image/')) {
      // Get dimensions for other image types
      dimensions = await getImageDimensions(fileBuffer);
    }

    const fileSize = fileBuffer.length;

    // Calculate MD5 hash (after potential conversion)
    const md5Hash = calculateMd5(fileBuffer);
    console.log(`Calculated MD5 for ${fileName}: ${md5Hash}`);

    // Check for duplicate by MD5
    const duplicate = await checkDuplicateByMd5(md5Hash, organizationId);
    
    if (duplicate) {
      console.log(`⊘ Skipped ${originalName} - duplicate detected (MD5: ${md5Hash})`);
      return {
        success: true,
        duplicate: true,
        mediaAssetId: duplicate.mediaAssetId,
        url: duplicate.url,
        fileName: originalName,
        fileSize,
        mimeType,
        message: 'File already exists (duplicate detected by MD5 hash)',
      };
    }

    // Generate unique filename to avoid conflicts
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}-${fileName}`;
    const filePath = `org-${organizationId}/${uniqueFileName}`;

    console.log(`Uploading file: ${uniqueFileName} for organization ${organizationId}`);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error(`Failed to upload to Supabase: ${error.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const supabaseUrl = publicUrlData.publicUrl;

    console.log(`File uploaded to: ${supabaseUrl}`);

    // Insert into supabase_storage table
    const supabaseStorageQuery = `
      INSERT INTO supabase_storage (
        supabase_url, storage_bucket, storage_path, file_name, 
        file_size, mime_type, file_extension, width, height,
        md5_hash, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id;
    `;

    const metadata = {
      original_filename: originalName,
      uploaded_at: new Date().toISOString(),
      source: 'direct_upload',
    };

    const supabaseStorageResult = await pool.query(supabaseStorageQuery, [
      supabaseUrl,
      bucketName,
      filePath,
      uniqueFileName,
      fileSize,
      mimeType,
      fileExtension,
      dimensions.width,
      dimensions.height,
      md5Hash,
      JSON.stringify(metadata),
    ]);

    const supabaseStorageId = supabaseStorageResult.rows[0].id;

    // Insert into media_assets table
    const mediaAssetQuery = `
      INSERT INTO media_assets (
        organization_id, asset_type, asset_url, 
        supabase_storage_id, caption, alt_text, is_shareable,
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id;
    `;

    const assetMetadata = {
      source: 'direct_upload',
      uploaded_at: new Date().toISOString(),
      original_filename: originalName,
      user_provided_title: title || null, // Store user-provided title if any
    };

    const mediaAssetResult = await pool.query(mediaAssetQuery, [
      organizationId,
      'uploaded_file',
      supabaseUrl,
      supabaseStorageId,
      caption || null,
      altText || null,
      isShareable,
      JSON.stringify(assetMetadata),
    ]);

    const mediaAssetId = mediaAssetResult.rows[0].id;

    console.log(`✓ Uploaded ${originalName} (ID: ${mediaAssetId})`);

    return {
      success: true,
      duplicate: false,
      mediaAssetId,
      supabaseStorageId,
      url: supabaseUrl,
      fileName: originalName,
      fileSize,
      mimeType,
      md5Hash,
    };
  } catch (error: any) {
    console.error('Upload error:', error);
    throw new Error(`Failed to upload media: ${error.message}`);
  }
};
