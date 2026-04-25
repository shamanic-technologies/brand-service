/**
 * HTTP client for campaign-service.
 *
 * Fetches and caches featureInputs per campaignId.
 * The cache never expires — featureInputs are immutable for the lifetime of a campaign.
 */

import { fetchWithRetry } from './fetch-with-retry';

const CAMPAIGN_SERVICE_URL =
  process.env.CAMPAIGN_SERVICE_URL || 'https://campaign.distribute.you';
const CAMPAIGN_SERVICE_API_KEY = process.env.CAMPAIGN_SERVICE_API_KEY || '';

// In-memory cache: campaignId → featureInputs (immutable per campaign)
const featureInputsCache = new Map<string, Record<string, unknown> | null>();

export function clearFeatureInputsCache(): void {
  featureInputsCache.clear();
}

interface CampaignTrackingHeaders {
  orgId: string;
  userId?: string;
  runId?: string;
}

/**
 * Fetch featureInputs for a campaign. Returns null if campaignId is missing,
 * the campaign has no featureInputs, or the fetch fails (graceful degradation).
 */
export async function getCampaignFeatureInputs(
  campaignId: string | undefined,
  tracking: CampaignTrackingHeaders,
): Promise<Record<string, unknown> | null> {
  if (!campaignId) return null;

  const cached = featureInputsCache.get(campaignId);
  if (cached !== undefined) return cached;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': CAMPAIGN_SERVICE_API_KEY,
      'x-org-id': tracking.orgId,
    };
    if (tracking.userId) headers['x-user-id'] = tracking.userId;
    if (tracking.runId) headers['x-run-id'] = tracking.runId;

    const response = await fetchWithRetry(
      `${CAMPAIGN_SERVICE_URL}/campaigns/${campaignId}`,
      {
        headers,
        label: `campaign-service GET /campaigns/${campaignId}`,
      },
    );

    const data = (await response.json()) as { campaign: { featureInputs?: Record<string, unknown> | null } };
    const inputs = data.campaign?.featureInputs ?? null;
    featureInputsCache.set(campaignId, inputs);
    return inputs;
  } catch (error: any) {
    console.warn(`[campaign-client] Failed to fetch featureInputs for campaign ${campaignId}:`, error.message);
    // Cache null to avoid retrying on every LLM call within the same request
    featureInputsCache.set(campaignId, null);
    return null;
  }
}
