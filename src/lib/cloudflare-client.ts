/**
 * HTTP client for cloudflare-service (R2 image storage).
 *
 * Uploads images by source URL. Cloudflare-service downloads the image,
 * stores it in R2, and returns a permanent public URL.
 */

import { fetchWithRetry } from './fetch-with-retry';

const CLOUDFLARE_SERVICE_URL = process.env.CLOUDFLARE_SERVICE_URL;
const CLOUDFLARE_SERVICE_API_KEY = process.env.CLOUDFLARE_SERVICE_API_KEY;

export interface CloudflareUploadParams {
  sourceUrl: string;
  folder: string;
  filename: string;
  contentType: string;
}

export interface CloudflareUploadBase64Params {
  contentBase64: string;
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
  audienceId?: string;
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
  if (tracking.audienceId) headers['x-audience-id'] = tracking.audienceId;
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

  const response = await fetchWithRetry(
    `${CLOUDFLARE_SERVICE_URL}/upload`,
    {
      method: 'POST',
      headers: buildHeaders(tracking),
      body: JSON.stringify({
        sourceUrl: params.sourceUrl,
        folder: params.folder,
        filename: params.filename,
        contentType: params.contentType,
      }),
      label: 'cloudflare-service POST /upload',
    },
  );

  return response.json() as Promise<CloudflareUploadResult>;
}

export async function uploadBase64ToCloudflare(
  params: CloudflareUploadBase64Params,
  tracking: CloudflareTrackingHeaders,
): Promise<CloudflareUploadResult> {
  if (!CLOUDFLARE_SERVICE_URL) {
    throw new Error('CLOUDFLARE_SERVICE_URL is not configured');
  }

  const response = await fetchWithRetry(
    `${CLOUDFLARE_SERVICE_URL}/upload/base64`,
    {
      method: 'POST',
      headers: buildHeaders(tracking),
      body: JSON.stringify({
        contentBase64: params.contentBase64,
        folder: params.folder,
        filename: params.filename,
        contentType: params.contentType,
      }),
      label: 'cloudflare-service POST /upload/base64',
    },
  );

  return response.json() as Promise<CloudflareUploadResult>;
}

export interface CloudflarePlatformUploadParams extends CloudflareUploadBase64Params {
  /** Whose work the upload is when no run of ours stands behind it (cost ledger). */
  support: { kind: 'brand_setup' | 'retired_product'; reason: string };
}

/**
 * Platform upload: no org or user stands behind the file (a company's
 * wordmark is identity, cross-org). cloudflare-service `POST
 * /internal/upload/base64` opens its own platform run, marked with `support`.
 */
export async function uploadPlatformBase64ToCloudflare(
  params: CloudflarePlatformUploadParams,
): Promise<CloudflareUploadResult> {
  if (!CLOUDFLARE_SERVICE_URL) {
    throw new Error('CLOUDFLARE_SERVICE_URL is not configured');
  }
  if (!CLOUDFLARE_SERVICE_API_KEY) {
    throw new Error('CLOUDFLARE_SERVICE_API_KEY is not configured');
  }

  const response = await fetchWithRetry(
    `${CLOUDFLARE_SERVICE_URL}/internal/upload/base64`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': CLOUDFLARE_SERVICE_API_KEY,
        'x-service-name': 'brand-service',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentBase64: params.contentBase64,
        folder: params.folder,
        filename: params.filename,
        contentType: params.contentType,
        support: params.support,
      }),
      label: 'cloudflare-service POST /internal/upload/base64',
    },
  );

  const body = (await response.json()) as Partial<CloudflareUploadResult> | null;
  if (!body || typeof body.url !== 'string' || body.url.trim() === '') {
    throw new Error('cloudflare-service POST /internal/upload/base64 answered without a url');
  }
  return body as CloudflareUploadResult;
}
