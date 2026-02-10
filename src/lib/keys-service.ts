import axios from 'axios';

const API_SERVICE_URL = process.env.API_SERVICE_URL || 'http://localhost:3000';
const API_SERVICE_API_KEY = process.env.API_SERVICE_API_KEY;
const PLATFORM_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const TRANSIENT_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function isTransientError(error: any): boolean {
  return TRANSIENT_ERROR_CODES.has(error.code);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get API key for an organization via api-service
 *
 * @param clerkOrgId - The Clerk organization ID
 * @param provider - The provider (e.g., "anthropic", "openai")
 * @param keyType - "byok" for user's key, "platform" for our key
 */
export async function getKeyForOrg(
  clerkOrgId: string,
  provider: string,
  keyType: "byok" | "platform"
): Promise<string | null> {
  // Platform key - use our own
  if (keyType === "platform") {
    if (provider === "anthropic") {
      return PLATFORM_ANTHROPIC_KEY || null;
    }
    console.warn(`No platform key configured for provider: ${provider}`);
    return null;
  }

  // BYOK - fetch via api-service with retries for transient errors
  const url = `${API_SERVICE_URL}/v1/internal/keys/${provider}/decrypt`;
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        params: { clerkOrgId },
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_SERVICE_API_KEY,
        },
        timeout: 10000,
      });

      return response.data?.key || null;
    } catch (error: any) {
      lastError = error;

      if (error.response?.status === 404) {
        console.log(`No BYOK key found for org ${clerkOrgId}, provider ${provider}`);
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
      console.error(`Error fetching key from api-service at ${url}: ${detail}${retryNote}`);
      throw new Error(`api-service key fetch failed: ${detail}${retryNote}`);
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError;
}
