/**
 * HTTP client for scraping-service (site mapping + page scraping).
 */

import axios from 'axios';

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
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/map`,
      {
        url,
        limit: 100,
        ...(tracking && {
          brandId: tracking.brandId,
          workflowSlug: tracking.workflowSlug,
        }),
      },
      { headers: buildHeaders(tracking), timeout: 30_000 },
    );
    if (!response.data.success) throw new Error(response.data.error || 'Map failed');
    return response.data.urls || [];
  } catch (error: any) {
    console.error('Map site URLs error:', error.message, error.response?.data);
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      const detail =
        error.response.data?.error ||
        (error.response.data?.details
          ? JSON.stringify(error.response.data.details)
          : null) ||
        error.message;
      throw new SiteMapError(`Could not map site URLs: ${detail}`);
    }
    throw new Error(`Failed to map site: ${error.message}`);
  }
}

export async function scrapeUrl(
  url: string,
  tracking?: ScrapingTrackingContext,
): Promise<string | null> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/scrape`,
      {
        url,
        sourceService: 'brand-service',
        ...(tracking && {
          brandId: tracking.brandId,
          workflowSlug: tracking.workflowSlug,
        }),
      },
      { headers: buildHeaders(tracking), timeout: 60_000 },
    );
    return response.data.result?.rawMarkdown || null;
  } catch (error: any) {
    console.error(`Scrape error for ${url}:`, error.message);
    return null;
  }
}
