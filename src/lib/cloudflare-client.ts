/**
 * HTTP client for cloudflare-service (R2 image storage).
 *
 * Uploads images by source URL. Cloudflare-service downloads the image,
 * stores it in R2, and returns a permanent public URL.
 */

import axios from 'axios';

const CLOUDFLARE_SERVICE_URL = process.env.CLOUDFLARE_SERVICE_URL;
const CLOUDFLARE_SERVICE_API_KEY = process.env.CLOUDFLARE_SERVICE_API_KEY;

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

  const response = await axios.post<CloudflareUploadResult>(
    `${CLOUDFLARE_SERVICE_URL}/upload`,
    {
      sourceUrl: params.sourceUrl,
      folder: params.folder,
      filename: params.filename,
      contentType: params.contentType,
    },
    { headers: buildHeaders(tracking), timeout: 60_000 },
  );

  return response.data;
}
