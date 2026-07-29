/**
 * HTTP client for client-service.
 *
 * client-service owns the user journey and sits between brand identity
 * (brand-service) and money (billing-service / stripe-service), so it owns the
 * answer to "has this org actually gone through checkout for this brand?".
 * brand-service NEVER recomputes that answer locally and never calls
 * billing/stripe for it.
 *
 * Used by the domain-takeover rule in `updateBrandWebsite`: a domain belongs to
 * whoever checked out on it; if nobody ever did, the domain is up for grabs.
 *
 * Conformed to the deployed contract of
 * `GET /internal/brands/{brandId}/checkout-status` — the never-paid case is a
 * truthful 200 (`not_checked_out` / `no_org_claims_brand`), never a 404.
 *
 * Fails LOUD. A network error, a non-2xx, or an unparseable body throws — the
 * caller must 502. Defaulting to "not checked out" would let a domain be taken
 * away from a paying org, so there is deliberately no fallback.
 */

import { fetchWithRetry } from './fetch-with-retry';

const CLIENT_SERVICE_URL =
  process.env.CLIENT_SERVICE_URL || 'https://client.distribute.you';
const CLIENT_SERVICE_API_KEY = process.env.CLIENT_SERVICE_API_KEY || '';

export interface BrandCheckoutStatus {
  /** True when at least one org claiming this brand completed checkout on it. */
  checkedOut: boolean;
  /** Internal org UUIDs that completed checkout on this brand (empty when none). */
  orgIds: string[];
}

/** Thrown when client-service cannot answer the checkout question. */
export class CheckoutStatusUnavailableError extends Error {
  readonly code = 'CHECKOUT_STATUS_UNAVAILABLE';
  constructor(brandId: string, cause: string) {
    super(`Could not resolve checkout status for brand ${brandId}: ${cause}`);
    this.name = 'CheckoutStatusUnavailableError';
  }
}

interface CheckoutStatusWire {
  checkedOut?: unknown;
  orgs?: unknown;
}

/**
 * Ask client-service whether ANY org has completed checkout on `brandId`.
 *
 * Returns the paying orgs so the caller can tell "your own org already paid on
 * this domain" apart from "another organization paid on it". Any failure to
 * reach or parse client-service throws — never a defaulted "nobody paid".
 */
export async function getBrandCheckoutStatus(
  brandId: string,
): Promise<BrandCheckoutStatus> {
  const url = `${CLIENT_SERVICE_URL}/internal/brands/${brandId}/checkout-status`;
  const label = 'client-service GET /internal/brands/:brandId/checkout-status';

  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CLIENT_SERVICE_API_KEY,
      },
      label,
      returnClientError: true,
    });
  } catch (err) {
    throw new CheckoutStatusUnavailableError(
      brandId,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new CheckoutStatusUnavailableError(
      brandId,
      `${label} returned ${response.status}: ${body}`,
    );
  }

  const parsed = (await response.json().catch(() => null)) as CheckoutStatusWire | null;

  if (!parsed || typeof parsed.checkedOut !== 'boolean' || !Array.isArray(parsed.orgs)) {
    throw new CheckoutStatusUnavailableError(
      brandId,
      `${label} returned an unexpected body shape`,
    );
  }

  // Per-org verdicts: the orgs that paid are the entries with checkedOut true.
  const orgIds = (parsed.orgs as Array<{ orgId?: unknown; checkedOut?: unknown }>)
    .filter((o) => o?.checkedOut === true && typeof o.orgId === 'string')
    .map((o) => o.orgId as string);

  return { checkedOut: parsed.checkedOut, orgIds };
}
