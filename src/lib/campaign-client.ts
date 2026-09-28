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
  audienceId?: string;
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
    if (tracking.audienceId) headers['x-audience-id'] = tracking.audienceId;

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

/** Thrown when campaign-service cannot say whether an offer has an ongoing campaign (→ 502). */
export class CampaignServiceUnavailableError extends Error {
  constructor(detail: string) {
    super(`campaign-service could not be asked for this offer's ongoing campaigns: ${detail}`);
    this.name = 'CampaignServiceUnavailableError';
  }
}

/**
 * The ids of every ONGOING campaign this org runs on this offer — the reason an
 * offer may not be archived. Read from campaign-service, which owns campaign
 * status (`GET /campaigns?offerId=&status=ongoing`).
 *
 * FAILS LOUD: any failure throws `CampaignServiceUnavailableError`, never `[]`.
 * "We could not look" must not read as "nothing is running", or an archive would
 * hide an offer a live campaign is spending on.
 */
export async function listOngoingCampaignIdsForOffer(
  offerId: string,
  tracking: CampaignTrackingHeaders,
): Promise<string[]> {
  const headers: Record<string, string> = {
    'X-API-Key': CAMPAIGN_SERVICE_API_KEY,
    'x-org-id': tracking.orgId,
  };
  if (tracking.userId) headers['x-user-id'] = tracking.userId;
  if (tracking.runId) headers['x-run-id'] = tracking.runId;

  const query = new URLSearchParams({ offerId, status: 'ongoing' });
  let data: { campaigns?: Array<{ id: string }> };
  try {
    const response = await fetchWithRetry(`${CAMPAIGN_SERVICE_URL}/campaigns?${query}`, {
      headers,
      label: 'campaign-service GET /campaigns?status=ongoing',
    });
    data = (await response.json()) as { campaigns?: Array<{ id: string }> };
  } catch (error: any) {
    throw new CampaignServiceUnavailableError(error?.message ?? String(error));
  }
  if (!Array.isArray(data.campaigns)) {
    throw new CampaignServiceUnavailableError('response carried no campaigns array');
  }
  return data.campaigns.map((c) => c.id);
}
