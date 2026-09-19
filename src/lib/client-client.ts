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

/**
 * Thrown when client-service cannot say which organisations are real.
 */
export class OrgRealityUnavailableError extends Error {
  readonly code = 'ORG_REALITY_UNAVAILABLE';
  constructor(cause: string) {
    super(`Could not resolve which organisations are real: ${cause}`);
    this.name = 'OrgRealityUnavailableError';
  }
}

interface OrgRealityWire {
  realOrgIds?: unknown;
}

/**
 * Which of these organisations are REAL?
 *
 * REAL = anything that is not an anonymous org still awaiting a claim. An org
 * that was never anonymous is real; an anonymous one that has SINCE been
 * claimed is real (somebody signed up and it is theirs); an anonymous one with
 * no claim is an abandoned signed-out walk and is not.
 *
 * Both halves of that are columns client-service WRITES (`anonymous_at` at
 * creation, `claimed_at` at the claim), which is why this is a question and not
 * a local test: nothing here may read the shape of an external org id, and
 * brand-service keeps no copy of who is anonymous.
 *
 * Conformed to the deployed contract of `POST /internal/orgs/real` — body
 * `{ orgIds }` (uuids, at most 500 per call), answer `{ realOrgIds }`, which is
 * the SUBSET of the ids that are real. An id naming no org is simply absent,
 * which is the same verdict.
 *
 * Fails LOUD, exactly like the checkout question above: a network error, a
 * non-2xx, or an unparseable body throws and the caller must 502. A defaulted
 * "none of them are real" would hand a paying customer's domain to a stranger.
 *
 * An empty list is answered here, with no call: there is nobody to ask about.
 */
export async function getRealOrgIds(orgIds: string[]): Promise<string[]> {
  const unique = [...new Set(orgIds)];
  if (unique.length === 0) return [];

  const url = `${CLIENT_SERVICE_URL}/internal/orgs/real`;
  const label = 'client-service POST /internal/orgs/real';

  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CLIENT_SERVICE_API_KEY,
      },
      body: JSON.stringify({ orgIds: unique }),
      label,
      returnClientError: true,
    });
  } catch (err) {
    throw new OrgRealityUnavailableError(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OrgRealityUnavailableError(`${label} returned ${response.status}: ${body}`);
  }

  const parsed = (await response.json().catch(() => null)) as OrgRealityWire | null;

  if (
    !parsed ||
    !Array.isArray(parsed.realOrgIds) ||
    parsed.realOrgIds.some((id) => typeof id !== 'string')
  ) {
    throw new OrgRealityUnavailableError(`${label} returned an unexpected body shape`);
  }

  return parsed.realOrgIds as string[];
}
