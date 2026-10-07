/**
 * HTTP client for apollo-service's org-less company lookup.
 *
 * `POST /internal/company-firmographics` (apollo-service owns the shape): Apollo
 * `organizations/enrich` by domain, platform-billed (1 apollo-credit when Apollo
 * knows the company, 0 when not), cached globally by apollo-service (90 days
 * found, 30 days not found), cost declared there. brand-service declares no
 * cost for it and sends no identity headers.
 *
 * Fails LOUD: a network error, a non-2xx or an unparseable body throws, so the
 * caller answers 502. "Apollo errored" is never read as "Apollo knows nothing".
 */

import { fetchWithRetry } from './fetch-with-retry';

const APOLLO_SERVICE_URL = process.env.APOLLO_SERVICE_URL || 'http://apollo-service:8080';
const APOLLO_SERVICE_API_KEY = process.env.APOLLO_SERVICE_API_KEY || '';

export interface ApolloCompany {
  /** The domain Apollo's record is for (its primary domain), lower-cased. */
  domain: string;
  /** Apollo's `linkedin_url`, verbatim. null when Apollo has none. */
  linkedinUrl: string | null;
  apolloOrganizationId: string | null;
}

/** Apollo's company for `domain`, or null when Apollo knows none. Throws on any failure. */
export async function lookupApolloCompany(domain: string): Promise<ApolloCompany | null> {
  if (!APOLLO_SERVICE_API_KEY) throw new Error('[brand-service] APOLLO_SERVICE_API_KEY is not set');
  const label = 'apollo-service POST /internal/company-firmographics';
  const res = await fetchWithRetry(`${APOLLO_SERVICE_URL}/internal/company-firmographics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_SERVICE_API_KEY },
    body: JSON.stringify({ domain }),
    label,
    returnClientError: true,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} answered ${res.status}: ${text.slice(0, 300)}`);
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} answered a non-JSON body: ${text.slice(0, 300)}`);
  }
  if (body?.company === null) return null;
  const c = body?.company;
  if (!c || typeof c.domain !== 'string' || !('linkedinUrl' in c)) {
    throw new Error(`${label} answered an unknown shape: ${text.slice(0, 300)}`);
  }
  return {
    domain: c.domain.trim().toLowerCase(),
    linkedinUrl: typeof c.linkedinUrl === 'string' && c.linkedinUrl.trim() ? c.linkedinUrl.trim() : null,
    apolloOrganizationId: typeof c.apolloOrganizationId === 'string' ? c.apolloOrganizationId : null,
  };
}
