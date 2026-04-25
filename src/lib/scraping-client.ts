/**
 * HTTP client for scraping-service (site mapping + page scraping).
 */

import { fetchWithRetry } from './fetch-with-retry';

const SCRAPING_SERVICE_URL =
  process.env.SCRAPING_SERVICE_URL || 'http://localhost:3010';
const SCRAPING_SERVICE_API_KEY = process.env.SCRAPING_SERVICE_API_KEY || '';

export interface ScrapingTrackingContext {
  brandId: string;
  orgId: string;
  userId?: string;
  workflowSlug?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
}

/** Thrown when the scraping service cannot map/crawl the brand's site (client-recoverable). */
export class SiteMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteMapError';
  }
}

function buildHeaders(tracking?: ScrapingTrackingContext): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Key': SCRAPING_SERVICE_API_KEY,
    'Content-Type': 'application/json',
  };
  if (tracking?.orgId) headers['X-Org-Id'] = tracking.orgId;
  if (tracking?.userId) headers['X-User-Id'] = tracking.userId;
  if (tracking?.runId) headers['X-Run-Id'] = tracking.runId;
  if (tracking?.campaignId) headers['X-Campaign-Id'] = tracking.campaignId;
  if (tracking?.featureSlug) headers['X-Feature-Slug'] = tracking.featureSlug;
  if (tracking?.brandIdHeader) headers['X-Brand-Id'] = tracking.brandIdHeader;
  if (tracking?.workflowSlug) headers['X-Workflow-Slug'] = tracking.workflowSlug;
  return headers;
}

export async function mapSiteUrls(
  url: string,
  tracking?: ScrapingTrackingContext,
): Promise<string[]> {
  try {
    const response = await fetchWithRetry(
      `${SCRAPING_SERVICE_URL}/map`,
      {
        method: 'POST',
        headers: buildHeaders(tracking),
        body: JSON.stringify({
          url,
          limit: 100,
          ...(tracking && {
            brandId: tracking.brandId,
            workflowSlug: tracking.workflowSlug,
          }),
        }),
        label: 'scraping-service POST /map',
      },
    );
    const data = await response.json() as { success: boolean; error?: string; urls?: string[] };
    if (!data.success) throw new Error(data.error || 'Map failed');
    return data.urls || [];
  } catch (error: any) {
    console.error('Map site URLs error:', error.message);
    // AbortError from fetchWithRetry means 4xx — treat as SiteMapError
    if (error.name === 'AbortError' || (error.message && error.message.includes('returned 4'))) {
      throw new SiteMapError(`Could not map site URLs: ${error.message}`);
    }
    throw new Error(`Failed to map site: ${error.message}`);
  }
}

export async function scrapeUrl(
  url: string,
  tracking?: ScrapingTrackingContext,
): Promise<string | null> {
  try {
    const response = await fetchWithRetry(
      `${SCRAPING_SERVICE_URL}/scrape`,
      {
        method: 'POST',
        headers: buildHeaders(tracking),
        body: JSON.stringify({
          url,
          sourceService: 'brand-service',
          ...(tracking && {
            brandId: tracking.brandId,
            workflowSlug: tracking.workflowSlug,
          }),
        }),
        label: 'scraping-service POST /scrape',
      },
    );
    const data = await response.json() as { result?: { rawMarkdown?: string } };
    return data.result?.rawMarkdown || null;
  } catch (error: any) {
    console.error(`Scrape error for ${url}:`, error.message);
    return null;
  }
}
