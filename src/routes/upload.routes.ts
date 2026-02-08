import { Router, Request, Response } from 'express';
import multer from 'multer';
import { startImportJob } from '../services/importMediaService';
import { uploadMediaFile } from '../services/uploadMediaService';
import { getJob } from '../services/jobTrackingService';
import { ImportFromGDriveRequestSchema } from '../schemas';

const router = Router();

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only media files
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/heic', 'image/heif',
      'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm',
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.mimetype}`));
    }
  },
});

// POST import from Google Drive (async with job tracking)
router.post('/import-from-google-drive', async (req: Request, res: Response) => {
  const parsed = ImportFromGDriveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { external_organization_id, google_drive_url } = parsed.data;

  try {
    console.log(`Starting async import for external org ${external_organization_id} from ${google_drive_url}`);
    
    // Start async job and return job_id immediately
    const jobId = await startImportJob(
      external_organization_id,
      google_drive_url
    );
    
    res.json({
      success: true,
      job_id: jobId,
      message: 'Import job started. Use GET /import-jobs/:jobId to track progress.',
    });
  } catch (error: any) {
    console.error('Error in POST /import-from-google-drive endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while starting import job.',
      details: error.message 
    });
  }
});

// GET job progress
router.get('/import-jobs/:jobId', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  try {
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found. It may have expired (jobs are kept for 1 hour).',
      });
    }

    res.json({
      success: true,
      job,
    });
  } catch (error: any) {
    console.error('Error in GET /import-jobs/:jobId endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching job status.',
      details: error.message,
    });
  }
});

// POST upload media file
router.post('/upload-media', upload.single('file'), async (req: Request, res: Response) => {
  const { external_organization_id, title, caption, alt_text, is_shareable } = req.body;
  const file = req.file;

  if (!external_organization_id) {
    return res.status(400).json({ error: 'external_organization_id is required.' });
  }

  if (!file) {
    return res.status(400).json({ error: 'file is required.' });
  }

  try {
    console.log(`Uploading file for external org ${external_organization_id}: ${file.originalname}`);
    
    const result = await uploadMediaFile({
      externalOrganizationId: external_organization_id,
      file,
      title,
      caption,
      altText: alt_text,
      isShareable: is_shareable === 'true' || is_shareable === true,
    });
    
    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in POST /upload-media endpoint:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while uploading media.',
      details: error.message 
    });
  }
});

export default router;

