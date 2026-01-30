import sharp from 'sharp';
import { Readable } from 'stream';
import heicConvert from 'heic-convert';

/**
 * Convert HEIC/HEIF images to JPEG format
 * Also handles dimensions extraction
 */
export const convertHeicToJpeg = async (
  buffer: Buffer
): Promise<{ buffer: Buffer; width: number; height: number }> => {
  try {
    // Use heic-convert for HEIC → JPEG conversion
    const outputBuffer = await heicConvert({
      buffer: buffer,
      format: 'JPEG',
      quality: 0.9, // 90% quality
    });

    // Convert to Buffer if it's an ArrayBuffer
    const jpegBuffer = Buffer.from(outputBuffer);

    // Use sharp to get dimensions from the converted JPEG
    const metadata = await sharp(jpegBuffer).metadata();

    return {
      buffer: jpegBuffer,
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch (error) {
    console.error('Error converting HEIC to JPEG:', error);
    throw new Error('Failed to convert HEIC image to JPEG');
  }
};

/**
 * Convert a stream to buffer (needed for Google Drive downloads)
 */
export const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

/**
 * Check if a mime type is HEIC/HEIF
 */
export const isHeicImage = (mimeType: string | null | undefined): boolean => {
  if (!mimeType) return false;
  return mimeType.toLowerCase().includes('heic') || mimeType.toLowerCase().includes('heif');
};

/**
 * Get image dimensions from buffer
 */
export const getImageDimensions = async (
  buffer: Buffer
): Promise<{ width: number | null; height: number | null }> => {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width || null,
      height: metadata.height || null,
    };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    return { width: null, height: null };
  }
};

/**
 * Convert file extension from HEIC to JPG
 */
export const convertHeicExtension = (fileName: string): string => {
  return fileName.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
};

