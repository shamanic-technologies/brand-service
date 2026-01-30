import { google } from 'googleapis';
import axios from 'axios';
import { Readable } from 'stream';

// Initialize Google Drive API with service account
const getGoogleDriveClient = () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  
  // Use JWT constructor directly instead of GoogleAuth to avoid deprecation warnings
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
};

// Extract file or folder ID from various Google Drive URL formats
export const extractDriveId = (url: string): string | null => {
  // Handle various formats:
  // https://drive.google.com/file/d/FILE_ID/view
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/open?id=ID
  
  const patterns = [
    /\/file\/d\/([^\/\?]+)/,
    /\/folders\/([^\/\?]+)/,
    /[?&]id=([^&]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
};

// Check if item is a folder
export const isFolder = async (fileId: string): Promise<boolean> => {
  try {
    const drive = getGoogleDriveClient();
    const response = await drive.files.get({
      fileId,
      fields: 'mimeType',
    });
    
    return response.data.mimeType === 'application/vnd.google-apps.folder';
  } catch (error) {
    console.error('Error checking if folder:', error);
    throw error;
  }
};

// List all media files in a folder (recursive)
export const listMediaFilesInFolder = async (folderId: string): Promise<any[]> => {
  const drive = getGoogleDriveClient();
  const mediaFiles: any[] = [];

  // Media types we're interested in
  const mediaTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/heic', 'image/heif',
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm',
  ];

  const listFiles = async (parentId: string) => {
    let pageToken: string | undefined = undefined;

    do {
      const response: any = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webContentLink, webViewLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata, md5Checksum)',
        pageToken,
      });

      const files = response.data.files || [];

      for (const file of files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          // Recursively list files in subfolder
          await listFiles(file.id!);
        } else if (mediaTypes.includes(file.mimeType || '')) {
          mediaFiles.push(file);
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  };

  await listFiles(folderId);
  return mediaFiles;
};

// Get single file metadata
export const getFileMetadata = async (fileId: string): Promise<any> => {
  try {
    const drive = getGoogleDriveClient();
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webContentLink, webViewLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata, md5Checksum',
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting file metadata:', error);
    throw error;
  }
};

// Download file from Google Drive as stream
export const downloadFileAsStream = async (fileId: string): Promise<Readable> => {
  try {
    const drive = getGoogleDriveClient();
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    
    return response.data as Readable;
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
};

// Get list of all media files from a Google Drive URL (file or folder)
export const getMediaFilesFromUrl = async (driveUrl: string): Promise<any[]> => {
  const driveId = extractDriveId(driveUrl);
  
  if (!driveId) {
    throw new Error('Invalid Google Drive URL');
  }

  const isFolderCheck = await isFolder(driveId);

  if (isFolderCheck) {
    // It's a folder, list all media files
    return await listMediaFilesInFolder(driveId);
  } else {
    // It's a single file
    const fileMetadata = await getFileMetadata(driveId);
    return [fileMetadata];
  }
};

