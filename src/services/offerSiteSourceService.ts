import { and, eq, gt, like, sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import { db, brands, pageScrapeCache } from '../db';
import { scrapeUrl, type ScrapingTrackingContext } from '../lib/scraping-client';
import { rethrowIfInsufficientCredits } from '../lib/insufficient-credits';
import { PAGE_CACHE_TTL_DAYS, pageCacheCutoff } from '../lib/page-cache-ttl';
import {
  buildBusinessContextSource,
  buildSiteSource,
  type OfferSiteSource,
  type SitePageText,
} from '../lib/offer-site-source';
import { htmlToText } from './brandCompetitorsService';
import { getBrandBusinessContext } from './brandBusinessContextService';
import { OfferNotFoundError } from './brandOffersService';
import { getCachedPageContent, normalizeUrl, upsertPageContent } from './scrapeOrchestrator';

/**
 * Reads a brand's own site for the one-step offer proposal, cheapest first:
 *
 *   - the HOMEPAGE: the saved copy (the site read of onboarding steps 1-2 saved
 *     it), else a plain HTTP read (free), else ONE scrape through
 *     scraping-service, billed to the asking org (it declares the cost);
 *   - every OTHER page of the registrable domain already saved in the page
 *     cache (free: the extraction paid for it), never a new scrape.
 *
 * A brand with no website reads its pasted business context instead. Nothing
 * readable at all is `SiteUnreadableError` (→ 422), never an empty proposal.
 */

const HOMEPAGE_TIMEOUT_MS = 8000;
const HOMEPAGE_MAX_HTML = 2_000_000;
const MAX_CACHED_ROWS = 200;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Neither the site nor a pasted business context gave any text (→ 422). */
export class SiteUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteUnreadableError';
  }
}

export interface OfferSiteReader {
  cachedPage(url: string): Promise<string | null>;
  plainPage(url: string): Promise<string | null>;
  scrapePage(url: string): Promise<string | null>;
  cachedSitePages(domain: string): Promise<SitePageText[]>;
  businessContext(): Promise<string | null>;
}

async function plainPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HOMEPAGE_TIMEOUT_MS),
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
    const text = htmlToText((await res.text()).slice(0, HOMEPAGE_MAX_HTML));
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

async function cachedSitePages(domain: string): Promise<SitePageText[]> {
  const rows = await db
    .select({ url: pageScrapeCache.url, content: pageScrapeCache.content })
    .from(pageScrapeCache)
    .where(
      and(
        like(pageScrapeCache.normalizedUrl, `%${domain}%`),
        gt(pageScrapeCache.expiresAt, sql`NOW()`),
        gt(pageScrapeCache.scrapedAt, pageCacheCutoff()),
      ),
    )
    .limit(MAX_CACHED_ROWS);
  return rows.filter((r) => {
    try {
      return getDomain(new URL(r.url).hostname, { allowPrivateDomains: false }) === domain;
    } catch {
      return false;
    }
  });
}

export function defaultOfferSiteReader(orgId: string, brandId: string, tracking: ScrapingTrackingContext): OfferSiteReader {
  return {
    cachedPage: getCachedPageContent,
    plainPage,
    async scrapePage(url: string) {
      try {
        const content = await scrapeUrl(url, tracking);
        if (content) await upsertPageContent(url, content, PAGE_CACHE_TTL_DAYS);
        return content || null;
      } catch (error) {
        rethrowIfInsufficientCredits(error);
        console.warn(`[brand-service] [${brandId}] offer site read: homepage scrape failed for ${url}:`, error);
        return null;
      }
    },
    cachedSitePages,
    businessContext: () => getBrandBusinessContext(orgId, brandId),
  };
}

/** Read the brand's site (or pasted context) into the proposal's source text. */
export async function readOfferSiteSource(brandId: string, reader: OfferSiteReader): Promise<OfferSiteSource> {
  const [brand] = await db
    .select({ name: brands.name, domain: brands.domain, url: brands.url })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new OfferNotFoundError(brandId);

  if (!brand.url) {
    const context = await reader.businessContext();
    const source = context ? buildBusinessContextSource(brand, context) : null;
    if (!source) {
      throw new SiteUnreadableError(
        'This brand has no website and no description of the business yet, so there is nothing to read its offers from.',
      );
    }
    return source;
  }

  const homepageUrl = brand.url;
  let homepageText = await reader.cachedPage(homepageUrl);
  if (!homepageText) homepageText = await reader.plainPage(homepageUrl);
  if (!homepageText) homepageText = await reader.scrapePage(homepageUrl);
  const homepage = homepageText ? { url: homepageUrl, content: homepageText } : null;

  let registrable: string | null = null;
  try {
    registrable = getDomain(new URL(homepageUrl).hostname, { allowPrivateDomains: false });
  } catch {
    registrable = null;
  }
  const homeKey = normalizeUrl(homepageUrl);
  const others = registrable
    ? (await reader.cachedSitePages(registrable)).filter((p) => normalizeUrl(p.url) !== homeKey)
    : [];

  const source = buildSiteSource(brand, homepage, others);
  if (!source) {
    throw new SiteUnreadableError(
      `We could not read ${brand.domain ?? homepageUrl}, so there is nothing to read its offers from. ` +
        'Describe what you sell instead.',
    );
  }
  return source;
}
