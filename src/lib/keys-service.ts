import axios from 'axios';

const API_SERVICE_URL = process.env.API_SERVICE_URL || 'http://localhost:3000';
const API_SERVICE_API_KEY = process.env.API_SERVICE_API_KEY;
const PLATFORM_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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

  // BYOK - fetch via api-service
  try {
    const response = await axios.get(
      `${API_SERVICE_URL}/internal/keys/${provider}/decrypt`,
      {
        params: { clerkOrgId },
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_SERVICE_API_KEY,
        },
        timeout: 10000,
      }
    );

    return response.data?.key || null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`No BYOK key found for org ${clerkOrgId}, provider ${provider}`);
      return null;
    }
    console.error(`Error fetching key from api-service:`, error.message);
    return null;
  }
}
