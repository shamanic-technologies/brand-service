/**
 * Transfer orchestration service.
 *
 * Discovers services that have POST /internal/transfer-brand via api-registry,
 * then fans out to each one (best-effort).
 * Membership verification is handled upstream by api-service.
 */

import { fetchWithRetry } from '../lib/fetch-with-retry';
import { AbortError } from 'p-retry';

interface ServiceInfo {
  name: string;
  baseUrl: string;
}

interface SearchResult {
  service: string;
  method: string;
  path: string;
}

/**
 * Discover services that expose POST /internal/transfer-brand via api-registry search.
 * Only returns services that actually have the endpoint registered.
 */
export async function discoverTransferServices(): Promise<ServiceInfo[]> {
  const url = process.env.API_REGISTRY_SERVICE_URL;
  const apiKey = process.env.API_REGISTRY_SERVICE_API_KEY;
  if (!url || !apiKey) {
    throw new Error('API_REGISTRY_SERVICE_URL and API_REGISTRY_SERVICE_API_KEY must be set');
  }

  // Get all services (for baseUrl lookup)
  const servicesRes = await fetchWithRetry(`${url}/services`, {
    headers: { 'x-api-key': apiKey },
    label: 'api-registry GET /services',
  });
  const { services: allServices } = (await servicesRes.json()) as { services: ServiceInfo[] };

  // Search for services that have POST /internal/transfer-brand
  const searchRes = await fetchWithRetry(
    `${url}/search?q=transfer-brand&method=POST&pathPrefix=/internal/`,
    { headers: { 'x-api-key': apiKey }, label: 'api-registry GET /search' },
  );
  const { results } = (await searchRes.json()) as { results: SearchResult[] };

  // Only keep services whose exact path is /internal/transfer-brand
  const serviceNames = new Set(
    results
      .filter((r) => r.path === '/internal/transfer-brand' && r.method === 'POST')
      .map((r) => r.service),
  );

  // Map service names to ServiceInfo (need baseUrl)
  return allServices.filter((s) => serviceNames.has(s.name));
}

export type ServiceResult =
  | { updatedTables: { tableName: string; count: number }[] }
  | { error: string }
  | { skipped: true };

/**
 * Call POST /internal/transfer-brand on a single service.
 * Returns the result or { error } on failure.
 */
async function callTransferBrand(
  service: ServiceInfo,
  body: { sourceBrandId: string; sourceOrgId: string; targetOrgId: string; targetBrandId?: string },
): Promise<ServiceResult> {
  // Env var convention: {NAME}_SERVICE_API_KEY (api-registry returns short names like "cloudflare", "campaign")
  const base = service.name.toUpperCase().replace(/-/g, '_');
  const envKey = base.endsWith('_SERVICE') ? `${base}_API_KEY` : `${base}_SERVICE_API_KEY`;
  const fallbackKey = process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || '';
  const apiKey = process.env[envKey] || fallbackKey;

  try {
    const response = await fetchWithRetry(
      `${service.baseUrl}/internal/transfer-brand`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        label: `transfer-brand ${service.name}`,
      },
    );

    const data = (await response.json()) as {
      updatedTables: { tableName: string; count: number }[];
    };
    return { updatedTables: data.updatedTables };
  } catch (err: any) {
    // AbortError = 4xx, log as info not error
    if (err instanceof AbortError) {
      console.log(`[brand-service] transfer-brand ${service.name}: ${err.message}`);
    } else {
      console.error(`[brand-service] transfer-brand ${service.name} failed:`, err.message);
    }
    return { error: err.message };
  }
}

/**
 * Fan out /internal/transfer-brand to all discovered services.
 * Calls are made in parallel. brand-service is skipped (handled inline).
 */
export async function fanOutTransfer(
  services: ServiceInfo[],
  body: { sourceBrandId: string; sourceOrgId: string; targetOrgId: string; targetBrandId?: string },
): Promise<Record<string, ServiceResult>> {
  const results: Record<string, ServiceResult> = {};

  const otherServices = services.filter(
    (s) => s.name !== 'brand' && s.name !== 'brand-service',
  );

  const entries = await Promise.all(
    otherServices.map(async (service) => {
      const result = await callTransferBrand(service, body);
      return [service.name, result] as const;
    }),
  );

  for (const [name, result] of entries) {
    results[name] = result;
  }

  return results;
}
