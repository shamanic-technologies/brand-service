import axios from 'axios';

const KEYS_SERVICE_URL = process.env.KEYS_SERVICE_URL || 'http://localhost:3001';
const PLATFORM_ANTHROPIC_KEY = process.env.PLATFORM_ANTHROPIC_API_KEY;

/**
 * Get API key for an organization from keys-service
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

  // BYOK - fetch from keys-service
  try {
    const response = await axios.get(
      `${KEYS_SERVICE_URL}/internal/keys/${provider}`,
      {
        headers: {
          'X-Clerk-Org-Id': clerkOrgId,
          'Content-Type': 'application/json',
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
    console.error(`Error fetching key from keys-service:`, error.message);
    return null;
  }
}
