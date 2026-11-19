/**
 * HTTP client for scraping-service (site mapping + page scraping).
 */

import { rethrowIfInsufficientCredits } from './insufficient-credits';
import { fetchWithRetry } from './fetch-with-retry';
import { keepBrandDomainUrls } from './brand-domain';

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
  audienceId?: string;
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
  if (tracking?.audienceId) headers['X-Audience-Id'] = tracking.audienceId;
  return headers;
}

/**
 * Map a site's URLs, subdomains included: a brand's docs., blog. and help.
 * hosts are part of its site. Firecrawl leaves them out unless asked, and the
 * map costs the same one credit either way. Callers still filter the result to
 * the brand's registrable domain (`keepBrandDomainUrls`).
 */
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
          includeSubdomains: true,
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
    // The org cannot pay for the map: not a site we could not read.
    rethrowIfInsufficientCredits(error);
    // AbortError from fetchWithRetry means 4xx — treat as SiteMapError
    if (error.name === 'AbortError' || (error.message && error.message.includes('returned 4'))) {
      throw new SiteMapError(`Could not map site URLs: ${error.message}`);
    }
    throw new Error(`Failed to map site: ${error.message}`);
  }
}

/**
 * True when a page asked for at `requestedUrl` was served from another
 * registrable domain (`resolvedUrl`, the final URL after redirects). Its
 * content belongs to that other site, never to the owner of `requestedUrl`.
 *
 * Example (PREVIEW-EMAIL-WRONG-BRAND-1119): pressbeat.io is forwarded (301) to
 * distribute.you; its "homepage" was distribute.you's, stored as PressBeat's
 * facts, and PressBeat's first email pitched distribute.you's case studies.
 * A redirect within the same registrable domain (http to https, www., a
 * docs. subdomain) stays the site's own page.
 */
export function landedOffSite(requestedUrl: string, resolvedUrl: string | null | undefined): boolean {
  if (!resolvedUrl) return false;
  return keepBrandDomainUrls([resolvedUrl], requestedUrl).length === 0;
}

/** One scraped page: its content, or where it went when it redirected to another site. */
export interface ScrapedPageResult {
  content: string | null;
  /** Set when the page redirected to another registrable domain; `content` is then null. */
  offSiteTo?: string;
}

/**
 * Scrape one page. `content` is null when the page could not be read, and when
 * it redirected to another registrable domain (`offSiteTo`): what that serves
 * is another site's content, so no caller may attribute it to `url`'s owner.
 */
export async function scrapePage(
  url: string,
  tracking?: ScrapingTrackingContext,
): Promise<ScrapedPageResult> {
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
    const data = await response.json() as { result?: { rawMarkdown?: string; resolvedUrl?: string | null } };
    const resolvedUrl = data.result?.resolvedUrl;
    if (resolvedUrl === undefined) {
      console.warn(`[brand-service] scraping-service returned no resolvedUrl for ${url}: cannot tell whether it redirected off-site`);
    }
    if (resolvedUrl && landedOffSite(url, resolvedUrl)) {
      console.warn(`[brand-service] ${url} redirects off-site to ${resolvedUrl}: content dropped, it is not this site's page`);
      return { content: null, offSiteTo: resolvedUrl };
    }
    return { content: data.result?.rawMarkdown || null };
  } catch (error: any) {
    console.error(`Scrape error for ${url}:`, error.message);
    // A refusal for money is not "no content": it must reach the caller.
    rethrowIfInsufficientCredits(error);
    return { content: null };
  }
}

/** `scrapePage`'s content alone (null when unreadable or served by another site). */
export async function scrapeUrl(
  url: string,
  tracking?: ScrapingTrackingContext,
): Promise<string | null> {
  return (await scrapePage(url, tracking)).content;
}
