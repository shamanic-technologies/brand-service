/**
 * The platform's STEP vocabulary, as features-service serves it
 * (`GET /public/catalogue/steps`: every catalogue step's key, name and icon).
 * features-service owns which steps exist; brand-service only checks that an
 * offer's stated step is one of them, so a Copilot turn can never store a step
 * nobody can measure or sell through.
 *
 * Cached in memory for 5 minutes (the producer itself sends `max-age=300`).
 * A failed read THROWS `StepCatalogueUnavailableError` (the route answers 502):
 * a write is never accepted unchecked because the catalogue was unreachable.
 */

const FEATURES_SERVICE_URL = process.env.FEATURES_SERVICE_URL || 'http://features-service:8080';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CatalogueStep {
  key: string;
  name: string;
}

export class StepCatalogueUnavailableError extends Error {
  constructor(detail: string) {
    super(`The step catalogue (features-service) could not be read: ${detail}`);
    this.name = 'StepCatalogueUnavailableError';
  }
}

let cache: { at: number; steps: CatalogueStep[] } | null = null;

export function clearStepCatalogueCache(): void {
  cache = null;
}

export async function fetchStepCatalogue(): Promise<CatalogueStep[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.steps;
  let response: Response;
  try {
    response = await fetch(`${FEATURES_SERVICE_URL}/public/catalogue/steps`, { signal: AbortSignal.timeout(10_000) });
  } catch (error: any) {
    throw new StepCatalogueUnavailableError(error?.message ?? String(error));
  }
  if (!response.ok) throw new StepCatalogueUnavailableError(`HTTP ${response.status}`);
  const body = (await response.json()) as { rows?: Array<{ key?: unknown; name?: unknown }> };
  if (!Array.isArray(body.rows)) throw new StepCatalogueUnavailableError('no `rows` in the response');
  const steps = body.rows
    .filter((r): r is { key: string; name: string } => typeof r.key === 'string' && typeof r.name === 'string')
    .map((r) => ({ key: r.key, name: r.name }));
  if (steps.length === 0) throw new StepCatalogueUnavailableError('the catalogue lists no step');
  cache = { at: Date.now(), steps };
  return steps;
}
