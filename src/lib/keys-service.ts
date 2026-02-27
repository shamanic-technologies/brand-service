import axios from 'axios';

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || 'https://key.mcpfactory.org';
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

/**
 * Resolve the key-service decrypt URL and query params for a given keyType.
 *
 * - "platform" → /internal/platform-keys/{provider}/decrypt (no ID params)
 * - "app"      → /internal/app-keys/{provider}/decrypt?appId=...
 * - "byok"     → /internal/keys/{provider}/decrypt?orgId=...
 */
function resolveKeyEndpoint(
  provider: string,
  keyType: "platform" | "app" | "byok",
  orgId: string,
  appId?: string,
): { url: string; params: Record<string, string> } {
  switch (keyType) {
    case "platform":
      return {
        url: `${KEY_SERVICE_URL}/internal/platform-keys/${provider}/decrypt`,
        params: {},
      };
    case "app":
      if (!appId) throw new Error("appId is required for keyType 'app'");
      return {
        url: `${KEY_SERVICE_URL}/internal/app-keys/${provider}/decrypt`,
        params: { appId },
      };
    case "byok":
      return {
        url: `${KEY_SERVICE_URL}/internal/keys/${provider}/decrypt`,
        params: { orgId },
      };
  }
}

/**
 * Get API key via key-service
 *
 * @param orgId - The organization ID
 * @param provider - The provider (e.g., "anthropic", "openai")
 * @param keyType - "byok" for user's key, "app" for client app key, "platform" for platform key
 * @param caller - The caller context (HTTP method + path) for key-service audit headers
 * @param appId - Required when keyType is "app"
 */
export async function getKeyForOrg(
  orgId: string,
  provider: string,
  keyType: "platform" | "app" | "byok",
  caller: CallerContext,
  appId?: string,
): Promise<string | null> {
  const { url, params } = resolveKeyEndpoint(provider, keyType, orgId, appId);
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        params,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': KEY_SERVICE_API_KEY,
          'X-Caller-Service': 'brand',
          'X-Caller-Method': caller.method,
          'X-Caller-Path': caller.path,
        },
        timeout: 10000,
      });

      return response.data?.key || null;
    } catch (error: any) {
      lastError = error;

      if (error.response?.status === 404) {
        console.log(`No ${keyType} key found for provider ${provider}`);
        return null;
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
