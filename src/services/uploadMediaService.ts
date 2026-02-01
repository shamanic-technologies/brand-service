import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db, mediaAssets, supabaseStorage } from '../db';
import { getOrganizationIdByExternalId } from './organizationUpsertService';
import {
  convertHeicToJpeg,
  isHeicImage,
  convertHeicExtension,
  getImageDimensions,
} from './imageConversionService';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not configured');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
};

const getFileExtension = (fileName: string): string => {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const calculateMd5 = (buffer: Buffer): string => {
  return crypto.createHash('md5').update(buffer).digest('hex');
};

const checkDuplicateByMd5 = async (
  md5Hash: string,
  brandId: string
): Promise<{ mediaAssetId: string; url: string } | null> => {
  try {
    const result = await db
      .select({
        id: mediaAssets.id,
        supabaseUrl: supabaseStorage.supabaseUrl,
      })
      .from(mediaAssets)
      .innerJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
      .where(and(eq(supabaseStorage.md5Hash, md5Hash), eq(mediaAssets.brandId, brandId)))
      .limit(1);

    if (result.length > 0) {
      return {
        mediaAssetId: result[0].id,
        url: result[0].supabaseUrl,
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
    const brandId = await getOrganizationIdByExternalId(externalOrganizationId);

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
      dimensions = await getImageDimensions(fileBuffer);
    }

    const fileSize = fileBuffer.length;
    const md5Hash = calculateMd5(fileBuffer);
    console.log(`Calculated MD5 for ${fileName}: ${md5Hash}`);

    // Check for duplicate by MD5
    const duplicate = await checkDuplicateByMd5(md5Hash, brandId);

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

    // Generate unique filename
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}-${fileName}`;
    const filePath = `org-${brandId}/${uniqueFileName}`;

    console.log(`Uploading file: ${uniqueFileName} for brand ${brandId}`);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage.from(bucketName).upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error(`Failed to upload to Supabase: ${error.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
    const supabaseUrl = publicUrlData.publicUrl;

    console.log(`File uploaded to: ${supabaseUrl}`);

    // Insert into supabase_storage table
    const storageInsert = await db
      .insert(supabaseStorage)
      .values({
        supabaseUrl,
        storageBucket: bucketName,
        storagePath: filePath,
        fileName: uniqueFileName,
        fileSize,
        mimeType,
        fileExtension,
        width: dimensions.width,
        height: dimensions.height,
        md5Hash,
        metadata: {
          original_filename: originalName,
          uploaded_at: new Date().toISOString(),
          source: 'direct_upload',
        },
      })
      .returning({ id: supabaseStorage.id });

    const supabaseStorageId = storageInsert[0].id;

    // Insert into media_assets table
    const assetInsert = await db
      .insert(mediaAssets)
      .values({
        brandId,
        assetType: 'uploaded_file',
        assetUrl: supabaseUrl,
        supabaseStorageId,
        caption: caption || null,
        altText: altText || null,
        isShareable,
        metadata: {
          source: 'direct_upload',
          uploaded_at: new Date().toISOString(),
          original_filename: originalName,
          user_provided_title: title || null,
        },
      })
      .returning({ id: mediaAssets.id });

    const mediaAssetId = assetInsert[0].id;

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
