/**
 * Transfer orchestration service.
 *
 * Discovers all services via api-registry, then fans out
 * /internal/transfer-brand to every service (best-effort).
 * Membership verification is handled upstream by api-service.
 */

interface ServiceInfo {
  name: string;
  baseUrl: string;
}

/**
 * Discover all registered services from api-registry.
 */
export async function discoverServices(): Promise<ServiceInfo[]> {
  const url = process.env.API_REGISTRY_URL;
  const apiKey = process.env.API_REGISTRY_API_KEY;
  if (!url || !apiKey) {
    throw new Error('API_REGISTRY_URL and API_REGISTRY_API_KEY must be set');
  }

  const response = await fetch(`${url}/services`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`[brand-service] api-registry /services returned ${response.status}`);
  }

  const data = (await response.json()) as { services: ServiceInfo[] };
  return data.services;
}

export type ServiceResult =
  | { updatedTables: { tableName: string; count: number }[] }
  | { error: string }
  | { skipped: true };

/**
 * Call POST /internal/transfer-brand on a single service.
 * Returns the result or { skipped: true } on 404, { error } on 5xx.
 */
async function callTransferBrand(
  service: ServiceInfo,
  body: { brandId: string; sourceOrgId: string; targetOrgId: string },
): Promise<ServiceResult> {
  // Use the service's own API key convention: {SERVICE_NAME}_API_KEY env var
  const envKey = service.name.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  const fallbackKey = process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || '';
  const apiKey = process.env[envKey] || fallbackKey;

  try {
    const response = await fetch(
      `${service.baseUrl}/internal/transfer-brand`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (response.status === 404) {
      return { skipped: true };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(
        `[brand-service] transfer-brand ${service.name} returned ${response.status}: ${text}`,
      );
      return { error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      updatedTables: { tableName: string; count: number }[];
    };
    return { updatedTables: data.updatedTables };
  } catch (err: any) {
    console.error(
      `[brand-service] transfer-brand ${service.name} failed:`,
      err.message,
    );
    return { error: err.message };
  }
}

/**
 * Fan out /internal/transfer-brand to all discovered services.
 * Calls are made in parallel. brand-service is skipped (handled inline).
 */
export async function fanOutTransfer(
  services: ServiceInfo[],
  body: { brandId: string; sourceOrgId: string; targetOrgId: string },
): Promise<Record<string, ServiceResult>> {
  const results: Record<string, ServiceResult> = {};

  const otherServices = services.filter(
    (s) => s.name !== 'brand-service',
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
