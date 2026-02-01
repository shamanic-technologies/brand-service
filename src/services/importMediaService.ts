import { eq, and } from 'drizzle-orm';
import { db, mediaAssets, supabaseStorage } from '../db';
import { getMediaFilesFromUrl, downloadFileAsStream } from './googleDriveService';
import { uploadToSupabase } from './supabaseStorageService';
import { getOrganizationIdByExternalId } from './organizationUpsertService';
import { createJob, updateJobStatus, setCurrentFile, addFileResult } from './jobTrackingService';
import { convertHeicToJpeg, isHeicImage, convertHeicExtension, streamToBuffer } from './imageConversionService';

interface ImportResult {
  success: boolean;
  fileName: string;
  mediaAssetId?: string;
  error?: string;
}

interface ImportSummary {
  totalFiles: number;
  successCount: number;
  failedCount: number;
  results: ImportResult[];
}

const getFileExtension = (fileName: string): string => {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const checkDuplicateByMd5 = async (md5Hash: string, brandId: string): Promise<string | null> => {
  try {
    const result = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .innerJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
      .where(and(eq(supabaseStorage.md5Hash, md5Hash), eq(mediaAssets.brandId, brandId)))
      .limit(1);

    return result.length > 0 ? result[0].id : null;
  } catch (error: any) {
    console.error('Error checking duplicate:', error);
    return null;
  }
};

export const startImportJob = async (externalOrganizationId: string, googleDriveUrl: string): Promise<string> => {
  try {
    console.log(`[IMPORT JOB] Starting import for external_org_id: ${externalOrganizationId}`);

    const brandId = await getOrganizationIdByExternalId(externalOrganizationId);
    console.log(`[IMPORT JOB] Using internal brand ID: ${brandId}`);

    if (!brandId) {
      throw new Error(`Failed to get brand ID for external_org_id: ${externalOrganizationId}`);
    }

    console.log('Fetching files from Google Drive...');
    const driveFiles = await getMediaFilesFromUrl(googleDriveUrl);
    console.log(`Found ${driveFiles.length} media files`);

    const jobId = createJob(driveFiles.length);

    // Start processing in background
    processImportJob(jobId, brandId, driveFiles).catch((error) => {
      console.error(`Job ${jobId} failed:`, error);
      updateJobStatus(jobId, 'failed');
    });

    return jobId;
  } catch (error: any) {
    console.error('Import error:', error);
    throw new Error(`Failed to start import: ${error.message}`);
  }
};

const processImportJob = async (jobId: string, brandId: string, driveFiles: any[]): Promise<void> => {
  updateJobStatus(jobId, 'processing');

  for (const driveFile of driveFiles) {
    try {
      let fileName = driveFile.name;
      let mimeType = driveFile.mimeType;
      let fileSize = driveFile.size ? parseInt(driveFile.size) : null;
      let fileExtension = getFileExtension(fileName);
      let md5Hash = driveFile.md5Checksum || null;
      let width = driveFile.imageMediaMetadata?.width || driveFile.videoMediaMetadata?.width || null;
      let height = driveFile.imageMediaMetadata?.height || driveFile.videoMediaMetadata?.height || null;

      console.log(`Processing: ${fileName} (mime: ${mimeType})`);
      setCurrentFile(jobId, fileName);

      // Check for duplicate by MD5
      if (md5Hash) {
        const existingAssetId = await checkDuplicateByMd5(md5Hash, brandId);

        if (existingAssetId) {
          console.log(`⊘ Skipped ${fileName} - duplicate detected (MD5: ${md5Hash})`);
          addFileResult(jobId, {
            name: fileName,
            status: 'skipped',
            media_asset_id: existingAssetId,
            mime_type: mimeType,
          });
          continue;
        }
      }

      // Download file from Google Drive
      let fileStream = await downloadFileAsStream(driveFile.id);

      // Convert HEIC to JPEG if needed
      if (isHeicImage(mimeType)) {
        console.log(`Converting HEIC image: ${fileName}`);
        const buffer = await streamToBuffer(fileStream);
        const converted = await convertHeicToJpeg(buffer);

        const { Readable } = await import('stream');
        fileStream = Readable.from(converted.buffer);

        mimeType = 'image/jpeg';
        fileName = convertHeicExtension(fileName);
        fileExtension = 'jpg';
        width = converted.width;
        height = converted.height;
        fileSize = converted.buffer.length;

        console.log(`✓ Converted ${driveFile.name} to JPEG (${converted.width}x${converted.height})`);
      }

      // Upload to Supabase Storage
      console.log(`[IMPORT JOB] Uploading to Supabase with brand_id: ${brandId}`);
      const { url: supabaseUrl, path: storagePath } = await uploadToSupabase(brandId, fileName, fileStream, mimeType);

      console.log(`[IMPORT JOB] Uploaded to Supabase: ${supabaseUrl}`);

      const duration = driveFile.videoMediaMetadata?.durationMillis
        ? parseInt(driveFile.videoMediaMetadata.durationMillis) / 1000
        : null;

      const metadata = {
        google_drive_id: driveFile.id,
        google_drive_link: driveFile.webViewLink,
        created_time: driveFile.createdTime,
        modified_time: driveFile.modifiedTime,
      };

      // Insert into supabase_storage
      const storageInsert = await db
        .insert(supabaseStorage)
        .values({
          supabaseUrl,
          storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
          storagePath,
          fileName,
          fileSize,
          mimeType,
          fileExtension,
          width,
          height,
          duration: duration?.toString(),
          md5Hash,
          metadata,
        })
        .onConflictDoUpdate({
          target: supabaseStorage.supabaseUrl,
          set: {
            fileSize,
            width,
            height,
            duration: duration?.toString(),
            md5Hash,
            metadata,
            updatedAt: new Date().toISOString(),
          },
        })
        .returning({ id: supabaseStorage.id });

      const supabaseStorageId = storageInsert[0].id;

      const assetMetadata = {
        source: 'google_drive',
        google_drive_id: driveFile.id,
        google_drive_link: driveFile.webViewLink,
        imported_at: new Date().toISOString(),
        original_filename: fileName,
      };

      // Insert into media_assets
      const assetInsert = await db
        .insert(mediaAssets)
        .values({
          brandId,
          assetType: 'uploaded_file',
          assetUrl: supabaseUrl,
          supabaseStorageId,
          isShareable: true,
          metadata: assetMetadata,
        })
        .onConflictDoUpdate({
          target: mediaAssets.assetUrl,
          set: {
            supabaseStorageId,
            metadata: assetMetadata,
            updatedAt: new Date().toISOString(),
          },
        })
        .returning({ id: mediaAssets.id });

      const mediaAssetId = assetInsert[0].id;

      console.log(`✓ Imported ${fileName} (ID: ${mediaAssetId})`);

      addFileResult(jobId, {
        name: fileName,
        status: 'completed',
        media_asset_id: mediaAssetId,
        mime_type: mimeType,
      });
    } catch (fileError: any) {
      console.error(`✗ Failed to import ${driveFile.name}:`, fileError);
      addFileResult(jobId, {
        name: driveFile.name,
        status: 'failed',
        mime_type: driveFile.mimeType,
        error: fileError.message,
      });
    }
  }

  updateJobStatus(jobId, 'completed');
  console.log(`✅ Job ${jobId} completed`);
};

// Legacy function for backwards compatibility
export const importMediaFromGoogleDrive = async (
  externalOrganizationId: string,
  googleDriveUrl: string
): Promise<ImportSummary> => {
  const results: ImportResult[] = [];

  try {
    const brandId = await getOrganizationIdByExternalId(externalOrganizationId);
    console.log(`Using brand ID: ${brandId}`);

    const driveFiles = await getMediaFilesFromUrl(googleDriveUrl);
    console.log(`Found ${driveFiles.length} media files`);

    for (const driveFile of driveFiles) {
      try {
        const fileName = driveFile.name;
        const mimeType = driveFile.mimeType;
        const fileSize = driveFile.size ? parseInt(driveFile.size) : null;
        const fileExtension = getFileExtension(fileName);
        const md5Hash = driveFile.md5Checksum || null;

        console.log(`Processing: ${fileName}`);

        if (md5Hash) {
          const existingAssetId = await checkDuplicateByMd5(md5Hash, brandId);

          if (existingAssetId) {
            console.log(`⊘ Skipped ${fileName} - duplicate detected`);
            results.push({
              success: true,
              fileName,
              mediaAssetId: existingAssetId,
            });
            continue;
          }
        }

        const fileStream = await downloadFileAsStream(driveFile.id);
        const { url: supabaseUrl, path: storagePath } = await uploadToSupabase(brandId, fileName, fileStream, mimeType);

        const width = driveFile.imageMediaMetadata?.width || driveFile.videoMediaMetadata?.width || null;
        const height = driveFile.imageMediaMetadata?.height || driveFile.videoMediaMetadata?.height || null;
        const duration = driveFile.videoMediaMetadata?.durationMillis
          ? parseInt(driveFile.videoMediaMetadata.durationMillis) / 1000
          : null;

        const metadata = {
          google_drive_id: driveFile.id,
          google_drive_link: driveFile.webViewLink,
          created_time: driveFile.createdTime,
          modified_time: driveFile.modifiedTime,
        };

        const storageInsert = await db
          .insert(supabaseStorage)
          .values({
            supabaseUrl,
            storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
            storagePath,
            fileName,
            fileSize,
            mimeType,
            fileExtension,
            width,
            height,
            duration: duration?.toString(),
            md5Hash,
            metadata,
          })
          .returning({ id: supabaseStorage.id });

        const supabaseStorageId = storageInsert[0].id;

        const assetMetadata = {
          source: 'google_drive',
          google_drive_id: driveFile.id,
          google_drive_link: driveFile.webViewLink,
          imported_at: new Date().toISOString(),
          original_filename: fileName,
        };

        const assetInsert = await db
          .insert(mediaAssets)
          .values({
            brandId,
            assetType: 'uploaded_file',
            assetUrl: supabaseUrl,
            supabaseStorageId,
            isShareable: true,
            metadata: assetMetadata,
          })
          .returning({ id: mediaAssets.id });

        const mediaAssetId = assetInsert[0].id;

        results.push({
          success: true,
          fileName,
          mediaAssetId,
        });
      } catch (fileError: any) {
        console.error(`✗ Failed to import ${driveFile.name}:`, fileError);
        results.push({
          success: false,
          fileName: driveFile.name,
          error: fileError.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      totalFiles: driveFiles.length,
      successCount,
      failedCount,
      results,
    };
  } catch (error: any) {
    console.error('Import error:', error);
    throw new Error(`Failed to import media: ${error.message}`);
  }
};
