import axios from 'axios';

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || 'https://key.distribute.you';
const KEY_SERVICE_API_KEY = process.env.KEY_SERVICE_API_KEY;

const TRANSIENT_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function isTransientError(error: any): boolean {
  return TRANSIENT_ERROR_CODES.has(error.code);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface CallerContext {
  method: string;
  path: string;
}

export interface KeyResolution {
  key: string | null;
  keySource: 'platform' | 'org' | null;
}

/**
 * Resolve an API key via key-service using the unified decrypt endpoint.
 *
 * GET /keys/:provider/decrypt (orgId/userId via x-org-id/x-user-id headers)
 *
 * Returns both the key and the keySource ("platform" or "org") for cost reporting.
 */
export async function getKeyForOrg(
  orgId: string,
  userId: string,
  provider: string,
  caller: CallerContext,
  runId?: string,
  trackingHeaders?: { campaignId?: string; brandIdHeader?: string; workflowName?: string },
): Promise<KeyResolution> {
  const url = `${KEY_SERVICE_URL}/keys/${provider}/decrypt`;
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const headers: Record<string, string | undefined> = {
          'Content-Type': 'application/json',
          'x-api-key': KEY_SERVICE_API_KEY,
          'x-org-id': orgId,
          'x-user-id': userId,
          'X-Caller-Service': 'brand',
          'X-Caller-Method': caller.method,
          'X-Caller-Path': caller.path,
        };
      if (runId) {
        headers['x-run-id'] = runId;
      }
      if (trackingHeaders?.campaignId) {
        headers['x-campaign-id'] = trackingHeaders.campaignId;
      }
      if (trackingHeaders?.brandIdHeader) {
        headers['x-brand-id'] = trackingHeaders.brandIdHeader;
      }
      if (trackingHeaders?.workflowName) {
        headers['x-workflow-name'] = trackingHeaders.workflowName;
      }

      const response = await axios.get(url, {
        headers,
        timeout: 10000,
      });

      const key = response.data?.key || null;
      const keySource = response.data?.keySource || null;
      return { key, keySource };
    } catch (error: any) {
      lastError = error;

      if (error.response?.status === 404) {
        console.log(`No key found for provider ${provider}, orgId=${orgId}`);
        return { key: null, keySource: null };
      }

      // Retry on transient network errors
      if (isTransientError(error) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[keys-service] Transient error (${error.code}) fetching from ${url}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable or exhausted retries
      const detail = error.response?.status
        ? `HTTP ${error.response.status}: ${error.response.data?.error || error.message}`
        : `${error.code || 'UNKNOWN'}: ${error.message || 'no error message'}`;
      const retryNote = isTransientError(error) ? ` (after ${MAX_RETRIES} retries)` : '';
      console.error(`Error fetching key from key-service at ${url}: ${detail}${retryNote}`);
      throw new Error(`key-service fetch failed: ${detail}${retryNote}`);
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError;
}
