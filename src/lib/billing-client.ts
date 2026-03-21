/**
 * HTTP client for billing-service credit authorization.
 *
 * Call `authorizeCredits` before every paid platform operation.
 * If costSource is "org" (BYOK), skip authorization entirely.
 *
 * Flow:
 * 1. Resolve unit prices from costs-service (GET /v1/platform-prices/{name})
 * 2. Compute total required_cents = sum(price * quantity)
 * 3. Check org balance via billing-service (GET /v1/accounts/balance)
 * 4. Return { sufficient, balance_cents, required_cents }
 */

const BILLING_SERVICE_URL =
  process.env.BILLING_SERVICE_URL || "https://billing.distribute.you";
const BILLING_SERVICE_API_KEY = process.env.BILLING_SERVICE_API_KEY || "";

const COSTS_SERVICE_URL =
  process.env.COSTS_SERVICE_URL || "https://costs.distribute.you";
const COSTS_SERVICE_API_KEY = process.env.COSTS_SERVICE_API_KEY || "";

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
  brandId?: string;
  workflowName?: string;
}

export interface AuthorizeCreditsResult {
  sufficient: boolean;
  balance_cents: number;
  required_cents: number;
}

/**
 * Resolve the current platform price for a cost name from costs-service.
 * Returns pricePerUnitInUsdCents as a number.
 */
async function resolvePlatformPrice(
  costName: string,
  headers: Record<string, string>
): Promise<number> {
  const response = await fetch(
    `${COSTS_SERVICE_URL}/v1/platform-prices/${encodeURIComponent(costName)}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": COSTS_SERVICE_API_KEY,
        ...headers,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `costs-service GET /v1/platform-prices/${costName} failed: ${response.status} - ${errorText}`
    );
  }

  const price = (await response.json()) as {
    name: string;
    pricePerUnitInUsdCents: string;
  };
  return parseFloat(price.pricePerUnitInUsdCents);
}

/**
 * Check org credit balance via billing-service.
 */
async function getBalance(
  headers: Record<string, string>
): Promise<{ balance_cents: number; depleted: boolean }> {
  const response = await fetch(`${BILLING_SERVICE_URL}/v1/accounts/balance`, {
    method: "GET",
    headers: {
      "X-API-Key": BILLING_SERVICE_API_KEY,
      ...headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `billing-service GET /v1/accounts/balance failed: ${response.status} - ${errorText}`
    );
  }

  return response.json() as Promise<{ balance_cents: number; depleted: boolean }>;
}

/**
 * Request credit authorization by resolving prices from costs-service
 * and checking balance on billing-service.
 *
 * Returns `{ sufficient, balance_cents, required_cents }`.
 * Throws on network / unexpected errors so the caller can 502.
 */
export async function authorizeCredits(
  params: AuthorizeCreditsParams
): Promise<AuthorizeCreditsResult> {
  const identityHeaders: Record<string, string> = {
    "x-org-id": params.orgId,
  };

  if (params.userId) identityHeaders["x-user-id"] = params.userId;
  if (params.runId) identityHeaders["x-run-id"] = params.runId;
  if (params.campaignId) identityHeaders["x-campaign-id"] = params.campaignId;
  if (params.brandId) identityHeaders["x-brand-id"] = params.brandId;
  if (params.workflowName)
    identityHeaders["x-workflow-name"] = params.workflowName;

  // 1. Resolve prices from costs-service and compute total
  const pricePromises = params.items.map(async (item) => {
    const unitPrice = await resolvePlatformPrice(item.costName, identityHeaders);
    return unitPrice * item.quantity;
  });

  const itemCosts = await Promise.all(pricePromises);
  const required_cents = Math.ceil(
    itemCosts.reduce((sum, cost) => sum + cost, 0)
  );

  // 2. Check balance from billing-service
  const { balance_cents } = await getBalance(identityHeaders);

  return {
    sufficient: balance_cents >= required_cents,
    balance_cents,
    required_cents,
  };
}
