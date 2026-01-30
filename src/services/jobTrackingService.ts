import crypto from 'crypto';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FileProgress {
  name: string;
  status: 'completed' | 'processing' | 'failed' | 'skipped';
  media_asset_id?: string;
  mime_type?: string;
  error?: string;
}

export interface ImportJob {
  job_id: string;
  status: JobStatus;
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  current_file: string | null;
  files: FileProgress[];
  created_at: string;
  completed_at: string | null;
}

// In-memory storage for jobs (will be cleared on service restart)
const jobs = new Map<string, ImportJob>();

// Cleanup interval: remove jobs older than 1 hour
const JOB_RETENTION_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run cleanup every 5 minutes

// Start cleanup interval
setInterval(() => {
  const now = Date.now();
  const jobsToDelete: string[] = [];

  for (const [jobId, job] of jobs.entries()) {
    const createdAt = new Date(job.created_at).getTime();
    if (now - createdAt > JOB_RETENTION_MS) {
      jobsToDelete.push(jobId);
    }
  }

  jobsToDelete.forEach((jobId) => {
    console.log(`🧹 Cleaning up expired job: ${jobId}`);
    jobs.delete(jobId);
  });

  if (jobsToDelete.length > 0) {
    console.log(`🧹 Cleaned up ${jobsToDelete.length} expired job(s)`);
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Create a new import job
 */
export const createJob = (totalFiles: number): string => {
  const jobId = crypto.randomUUID();
  const job: ImportJob = {
    job_id: jobId,
    status: 'pending',
    progress: {
      total: totalFiles,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    },
    current_file: null,
    files: [],
    created_at: new Date().toISOString(),
    completed_at: null,
  };

  jobs.set(jobId, job);
  console.log(`✨ Created job ${jobId} for ${totalFiles} files`);
  return jobId;
};

/**
 * Get job by ID
 */
export const getJob = (jobId: string): ImportJob | null => {
  return jobs.get(jobId) || null;
};

/**
 * Update job status
 */
export const updateJobStatus = (jobId: string, status: JobStatus): void => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = status;
  
  if (status === 'completed' || status === 'failed') {
    job.completed_at = new Date().toISOString();
    job.current_file = null;
  }

  jobs.set(jobId, job);
};

/**
 * Set current file being processed
 */
export const setCurrentFile = (jobId: string, fileName: string): void => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.current_file = fileName;
  jobs.set(jobId, job);
};

/**
 * Add file result to job
 */
export const addFileResult = (
  jobId: string,
  file: FileProgress
): void => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.files.push(file);
  job.progress.processed++;

  if (file.status === 'completed') {
    job.progress.succeeded++;
  } else if (file.status === 'failed') {
    job.progress.failed++;
  } else if (file.status === 'skipped') {
    job.progress.skipped++;
  }

  jobs.set(jobId, job);
};

/**
 * Get all jobs (for debugging)
 */
export const getAllJobs = (): ImportJob[] => {
  return Array.from(jobs.values());
};

/**
 * Delete a job manually (useful for testing)
 */
export const deleteJob = (jobId: string): boolean => {
  return jobs.delete(jobId);
};

