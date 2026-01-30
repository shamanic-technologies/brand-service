import pool from '../db';
import { getMediaFilesFromUrl, downloadFileAsStream } from './googleDriveService';
import { uploadToSupabase } from './supabaseStorageService';
import { getOrganizationIdByExternalId } from './organizationUpsertService';
import { 
  createJob, 
  updateJobStatus, 
  setCurrentFile, 
  addFileResult 
} from './jobTrackingService';
import { 
  convertHeicToJpeg, 
  isHeicImage, 
  convertHeicExtension,
  streamToBuffer 
} from './imageConversionService';

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

// Extract file extension from filename
const getFileExtension = (fileName: string): string => {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

/**
 * Check if file with MD5 hash already exists in database for this organization
 */
const checkDuplicateByMd5 = async (
  md5Hash: string,
  organizationId: string
): Promise<string | null> => {
  try {
    const query = `
      SELECT ma.id
      FROM media_assets ma
      JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE ss.md5_hash = $1 AND ma.organization_id = $2
      LIMIT 1;
    `;
    
    const result = await pool.query(query, [md5Hash, organizationId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].id; // Return existing media_asset_id
    }
    
    return null;
  } catch (error: any) {
    console.error('Error checking duplicate:', error);
    return null;
  }
};

/**
 * Start import job (async) - returns job_id immediately
 */
export const startImportJob = async (
  externalOrganizationId: string,
  googleDriveUrl: string
): Promise<string> => {
  try {
    console.log(`[IMPORT JOB] Starting import for external_org_id: ${externalOrganizationId}`);
    
    // Get or create organization and get internal ID
    const organizationId = await getOrganizationIdByExternalId(externalOrganizationId);

    console.log(`[IMPORT JOB] Using internal organization ID: ${organizationId}`);
    
    if (!organizationId) {
      throw new Error(`Failed to get organization ID for external_org_id: ${externalOrganizationId}`);
    }

    // Step 1: Get all media files from Google Drive
    console.log('Fetching files from Google Drive...');
    const driveFiles = await getMediaFilesFromUrl(googleDriveUrl);
    
    console.log(`Found ${driveFiles.length} media files`);

    // Create job
    const jobId = createJob(driveFiles.length);

    // Start processing in background (don't await)
    processImportJob(jobId, organizationId, driveFiles).catch((error) => {
      console.error(`Job ${jobId} failed:`, error);
      updateJobStatus(jobId, 'failed');
    });

    return jobId;
  } catch (error: any) {
    console.error('Import error:', error);
    throw new Error(`Failed to start import: ${error.message}`);
  }
};

/**
 * Process import job in background
 */
const processImportJob = async (
  jobId: string,
  organizationId: string,
  driveFiles: any[]
): Promise<void> => {
  updateJobStatus(jobId, 'processing');

  for (const driveFile of driveFiles) {
    try {
      let fileName = driveFile.name;
      let mimeType = driveFile.mimeType;
      let fileSize = driveFile.size ? parseInt(driveFile.size) : null;
      let fileExtension = getFileExtension(fileName);
      let md5Hash = driveFile.md5Checksum || null;
      let width = driveFile.imageMediaMetadata?.width || 
                  driveFile.videoMediaMetadata?.width || null;
      let height = driveFile.imageMediaMetadata?.height || 
                   driveFile.videoMediaMetadata?.height || null;

      console.log(`Processing: ${fileName} (mime: ${mimeType})`);
      setCurrentFile(jobId, fileName);

      // Check for duplicate by MD5
      if (md5Hash) {
        const existingAssetId = await checkDuplicateByMd5(md5Hash, organizationId);
        
        if (existingAssetId) {
          console.log(`⊘ Skipped ${fileName} - duplicate detected (MD5: ${md5Hash})`);
          addFileResult(jobId, {
            name: fileName,
            status: 'skipped',
            media_asset_id: existingAssetId,
            mime_type: mimeType,
          });
          continue; // Skip this file
        }
      }

      // Download file from Google Drive
      let fileStream = await downloadFileAsStream(driveFile.id);

      // Convert HEIC to JPEG if needed
      if (isHeicImage(mimeType)) {
        console.log(`Converting HEIC image: ${fileName}`);
        const buffer = await streamToBuffer(fileStream);
        const converted = await convertHeicToJpeg(buffer);
        
        // Create a new stream from converted buffer
        const { Readable } = await import('stream');
        fileStream = Readable.from(converted.buffer);
        
        // Update file metadata after conversion
        mimeType = 'image/jpeg';
        fileName = convertHeicExtension(fileName);
        fileExtension = 'jpg';
        width = converted.width;
        height = converted.height;
        fileSize = converted.buffer.length;
        
        console.log(`✓ Converted ${driveFile.name} to JPEG (${converted.width}x${converted.height})`);
      }

      // Upload to Supabase Storage
      console.log(`[IMPORT JOB] Uploading to Supabase with org_id: ${organizationId}`);
      const { url: supabaseUrl, path: storagePath } = await uploadToSupabase(
        organizationId,
        fileName,
        fileStream,
        mimeType
      );

      console.log(`[IMPORT JOB] Uploaded to Supabase: ${supabaseUrl}`);

      // Extract video duration if applicable
      const duration = driveFile.videoMediaMetadata?.durationMillis 
                       ? parseInt(driveFile.videoMediaMetadata.durationMillis) / 1000 
                       : null;

      // Step 3: Insert into supabase_storage table
      const supabaseStorageQuery = `
        INSERT INTO supabase_storage (
          supabase_url, storage_bucket, storage_path, file_name, 
          file_size, mime_type, file_extension, width, height, duration,
          md5_hash, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        ON CONFLICT (supabase_url) 
        DO UPDATE SET 
          file_size = EXCLUDED.file_size,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          duration = EXCLUDED.duration,
          md5_hash = EXCLUDED.md5_hash,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING id;
      `;

      const metadata = {
        google_drive_id: driveFile.id,
        google_drive_link: driveFile.webViewLink,
        created_time: driveFile.createdTime,
        modified_time: driveFile.modifiedTime,
      };

      const supabaseStorageResult = await pool.query(supabaseStorageQuery, [
        supabaseUrl,
        process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
        storagePath,
        fileName,
        fileSize,
        mimeType,
        fileExtension,
        width,
        height,
        duration,
        md5Hash,
        JSON.stringify(metadata),
      ]);

      const supabaseStorageId = supabaseStorageResult.rows[0].id;

      // Step 4: Insert into media_assets table
      const mediaAssetQuery = `
        INSERT INTO media_assets (
          organization_id, asset_type, asset_url, 
          supabase_storage_id, is_shareable,
          metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (asset_url) 
        DO UPDATE SET 
          supabase_storage_id = EXCLUDED.supabase_storage_id,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING id, caption;
      `;

      const assetMetadata = {
        source: 'google_drive',
        google_drive_id: driveFile.id,
        google_drive_link: driveFile.webViewLink,
        imported_at: new Date().toISOString(),
        original_filename: fileName,
      };

      const mediaAssetResult = await pool.query(mediaAssetQuery, [
        organizationId,
        'uploaded_file',
        supabaseUrl,
        supabaseStorageId,
        true, // is_shareable
        JSON.stringify(assetMetadata),
      ]);

      const mediaAssetId = mediaAssetResult.rows[0].id;
      
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

  // Job completed
  updateJobStatus(jobId, 'completed');
  console.log(`✅ Job ${jobId} completed`);
};

// Legacy function for backwards compatibility (if needed)
export const importMediaFromGoogleDrive = async (
  externalOrganizationId: string,
  googleDriveUrl: string
): Promise<ImportSummary> => {
  const results: ImportResult[] = [];

  try {
    const organizationId = await getOrganizationIdByExternalId(externalOrganizationId);
    console.log(`Using organization ID: ${organizationId}`);

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

        // Check for duplicate by MD5
        if (md5Hash) {
          const existingAssetId = await checkDuplicateByMd5(md5Hash, organizationId);
          
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
        const { url: supabaseUrl, path: storagePath } = await uploadToSupabase(
          organizationId,
          fileName,
          fileStream,
          mimeType
        );

        const width = driveFile.imageMediaMetadata?.width || 
                      driveFile.videoMediaMetadata?.width || null;
        const height = driveFile.imageMediaMetadata?.height || 
                       driveFile.videoMediaMetadata?.height || null;
        const duration = driveFile.videoMediaMetadata?.durationMillis 
                         ? parseInt(driveFile.videoMediaMetadata.durationMillis) / 1000 
                         : null;

        const supabaseStorageQuery = `
          INSERT INTO supabase_storage (
            supabase_url, storage_bucket, storage_path, file_name, 
            file_size, mime_type, file_extension, width, height, duration,
            md5_hash, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
          RETURNING id;
        `;

        const metadata = {
          google_drive_id: driveFile.id,
          google_drive_link: driveFile.webViewLink,
          created_time: driveFile.createdTime,
          modified_time: driveFile.modifiedTime,
        };

        const supabaseStorageResult = await pool.query(supabaseStorageQuery, [
          supabaseUrl,
          process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
          storagePath,
          fileName,
          fileSize,
          mimeType,
          fileExtension,
          width,
          height,
          duration,
          md5Hash,
          JSON.stringify(metadata),
        ]);

        const supabaseStorageId = supabaseStorageResult.rows[0].id;

        const mediaAssetQuery = `
          INSERT INTO media_assets (
            organization_id, asset_type, asset_url, 
            supabase_storage_id, is_shareable,
            metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id;
        `;

        const assetMetadata = {
          source: 'google_drive',
          google_drive_id: driveFile.id,
          google_drive_link: driveFile.webViewLink,
          imported_at: new Date().toISOString(),
          original_filename: fileName,
        };

        const mediaAssetResult = await pool.query(mediaAssetQuery, [
          organizationId,
          'uploaded_file',
          supabaseUrl,
          supabaseStorageId,
          true,
          JSON.stringify(assetMetadata),
        ]);

        const mediaAssetId = mediaAssetResult.rows[0].id;

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
