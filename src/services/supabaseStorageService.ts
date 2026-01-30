import { createClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

// Initialize Supabase client
const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not configured');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
};

// Convert stream to buffer
const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

// Upload file to Supabase Storage
export const uploadToSupabase = async (
  clientOrganizationId: string,
  fileName: string,
  fileStream: Readable,
  mimeType: string
): Promise<{ url: string; path: string }> => {
  console.log(`[SUPABASE UPLOAD] Received org_id: ${clientOrganizationId} for file: ${fileName}`);
  
  if (!clientOrganizationId) {
    throw new Error(`clientOrganizationId is undefined or empty. Cannot upload file: ${fileName}`);
  }
  
  const supabase = getSupabaseClient();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';
  
  // Create path: client-org-{id}/filename
  const filePath = `client-org-${clientOrganizationId}/${fileName}`;
  console.log(`[SUPABASE UPLOAD] Using path: ${filePath}`);

  // Convert stream to buffer
  const fileBuffer = await streamToBuffer(fileStream);

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: true, // Overwrite if exists
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Failed to upload to Supabase: ${error.message}`);
  }

  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return {
    url: publicUrlData.publicUrl,
    path: filePath,
  };
};

// Check if file exists in Supabase Storage
export const fileExistsInSupabase = async (
  clientOrganizationId: string,
  fileName: string
): Promise<boolean> => {
  const supabase = getSupabaseClient();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';
  const filePath = `client-org-${clientOrganizationId}/${fileName}`;

  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .list(`client-org-${clientOrganizationId}`, {
        search: fileName,
      });

    if (error) return false;
    return data.some((file) => file.name === fileName);
  } catch (error) {
    return false;
  }
};

// Delete file from Supabase Storage
export const deleteFromSupabase = async (
  clientOrganizationId: string,
  fileName: string
): Promise<void> => {
  const supabase = getSupabaseClient();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';
  const filePath = `client-org-${clientOrganizationId}/${fileName}`;

  const { error } = await supabase.storage
    .from(bucketName)
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete from Supabase: ${error.message}`);
  }
};

