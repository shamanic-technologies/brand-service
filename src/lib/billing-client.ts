/**
 * HTTP client for billing-service credit authorization.
 *
 * Call `authorizeCredits` before every paid platform operation.
 * If costSource is "org" (BYOK), skip authorization entirely.
 */

const BILLING_SERVICE_URL =
  process.env.BILLING_SERVICE_URL || "https://billing.distribute.you";
const BILLING_SERVICE_API_KEY = process.env.BILLING_SERVICE_API_KEY || "";

export interface AuthorizeCreditItem {
  costName: string;
  quantity: number;
}

export interface AuthorizeCreditsParams {
  items: AuthorizeCreditItem[];
  description: string;
  orgId: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandId?: string;
  workflowSlug?: string;
}

export interface AuthorizeCreditsResult {
  sufficient: boolean;
  balance_cents: number;
  required_cents: number;
}

/**
 * Request credit authorization from billing-service.
 *
 * Send costName + quantity items — billing-service resolves the price internally.
 * Returns `{ sufficient, balance_cents, required_cents }`.
 * Throws on network / unexpected errors so the caller can 502.
 */
import { fetchWithRetry } from './fetch-with-retry';

export async function authorizeCredits(
  params: AuthorizeCreditsParams
): Promise<AuthorizeCreditsResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": BILLING_SERVICE_API_KEY,
    "x-org-id": params.orgId,
  };

  if (params.userId) headers["x-user-id"] = params.userId;
  if (params.runId) headers["x-run-id"] = params.runId;
  if (params.campaignId) headers["x-campaign-id"] = params.campaignId;
  if (params.featureSlug) headers["x-feature-slug"] = params.featureSlug;
  if (params.brandId) headers["x-brand-id"] = params.brandId;
  if (params.workflowSlug) headers["x-workflow-slug"] = params.workflowSlug;

  const response = await fetchWithRetry(`${BILLING_SERVICE_URL}/v1/credits/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: params.items,
      description: params.description,
    }),
    label: 'billing-service POST /v1/credits/authorize',
  });

  return response.json() as Promise<AuthorizeCreditsResult>;
}
