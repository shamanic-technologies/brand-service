/**
 * HTTP client for cloudflare-service (R2 image storage).
 *
 * Uploads images by source URL. Cloudflare-service downloads the image,
 * stores it in R2, and returns a permanent public URL.
 */

import axios from 'axios';

const CLOUDFLARE_SERVICE_URL = process.env.CLOUDFLARE_SERVICE_URL;
const CLOUDFLARE_SERVICE_API_KEY = process.env.CLOUDFLARE_SERVICE_API_KEY;

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

function isTransientError(error: any): boolean {
  if (TRANSIENT_ERROR_CODES.has(error.code)) return true;
  if (error.response?.status && TRANSIENT_STATUS_CODES.has(error.response.status)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface CloudflareUploadParams {
  sourceUrl: string;
  folder: string;
  filename: string;
  contentType: string;
}

export interface CloudflareUploadResult {
  id: string;
  url: string;
  size: number;
  contentType: string;
}

export interface CloudflareTrackingHeaders {
  orgId: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandId?: string;
  workflowSlug?: string;
}

function buildHeaders(tracking: CloudflareTrackingHeaders): Record<string, string> {
  if (!CLOUDFLARE_SERVICE_API_KEY) {
    throw new Error('CLOUDFLARE_SERVICE_API_KEY is not configured');
  }

  const headers: Record<string, string> = {
    'X-API-Key': CLOUDFLARE_SERVICE_API_KEY,
    'Content-Type': 'application/json',
    'x-org-id': tracking.orgId,
  };
  if (tracking.userId) headers['x-user-id'] = tracking.userId;
  if (tracking.runId) headers['x-run-id'] = tracking.runId;
  if (tracking.campaignId) headers['x-campaign-id'] = tracking.campaignId;
  if (tracking.featureSlug) headers['x-feature-slug'] = tracking.featureSlug;
  if (tracking.brandId) headers['x-brand-id'] = tracking.brandId;
  if (tracking.workflowSlug) headers['x-workflow-slug'] = tracking.workflowSlug;
  return headers;
}

/**
 * Returns true if cloudflare-service is configured (both URL and API key).
 * Call this before starting expensive pipelines that need R2 uploads.
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(CLOUDFLARE_SERVICE_URL) && Boolean(CLOUDFLARE_SERVICE_API_KEY);
}

export async function uploadToCloudflare(
  params: CloudflareUploadParams,
  tracking: CloudflareTrackingHeaders,
): Promise<CloudflareUploadResult> {
  if (!CLOUDFLARE_SERVICE_URL) {
    throw new Error('CLOUDFLARE_SERVICE_URL is not configured');
  }

  const url = `${CLOUDFLARE_SERVICE_URL}/upload`;
  const body = {
    sourceUrl: params.sourceUrl,
    folder: params.folder,
    filename: params.filename,
    contentType: params.contentType,
  };
  const config = { headers: buildHeaders(tracking), timeout: 60_000 };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post<CloudflareUploadResult>(url, body, config);
      return response.data;
    } catch (error: any) {
      if (isTransientError(error) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        const status = error.response?.status ?? error.code ?? 'unknown';
        console.warn(
          `[brand-service] Transient error (${status}) uploading to cloudflare-service, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error('uploadToCloudflare: unreachable');
}
