/**
 * The brand's OWN LinkedIn company page.
 *
 * First consumer: social-service, which reads the posts of that page for the
 * staff "Posting > Posts" view. We find it; nobody types it (done-for-you).
 *
 * Same method as a competitor's page (`brandCompetitorsService`): the page is
 * the one the brand's OWN website links FOR ITSELF (`extractLinkedinCompanyUrl`,
 * slug must match the brand's name or domain label, so a customer or partner it
 * links is never taken). Nothing is ever built from a name: a site that links
 * no company page answers `not_found`, never a guess.
 *
 * What is read, cheapest first:
 *   1. the homepage over plain HTTP (free);
 *   2. every page of the brand's site already sitting in `page_scrape_cache`
 *      (free: the extraction paid for those scrapes already);
 *   3. ONE scrape of the homepage through scraping-service, only when nothing
 *      above found a link, the homepage is not already cached, AND an org is in
 *      hand: scraping-service declares the cost, billed to that org on a
 *      brand-service run (child of `x-run-id`). With no org there is no one to
 *      bill, so the paid read is skipped.
 *
 * Found once, then reused: reads never compute, and discover returns the stored
 * answer unless `refresh`. No row = `not_computed`; a row with no URL =
 * `not_found`, a real answer, distinct from never having looked.
 */

import { and, eq, gt, like, sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import { db, brands, brandLinkedinPages, pageScrapeCache } from '../db';
import { createRun, updateRun } from '../lib/runs-client';
import { scrapeUrl, type ScrapingTrackingContext } from '../lib/scraping-client';
import { extractLinkedinCompanyUrl, normalizeCompetitorDomain } from '../lib/competitor-linkedin';
import { getCachedPageContent, upsertPageContent } from './scrapeOrchestrator';

/** The one place the URL may come from. */
export const LINKEDIN_SOURCE_BRAND_WEBSITE = 'brand_website' as const;

const HOMEPAGE_TIMEOUT_MS = 8000;
const HOMEPAGE_MAX_CHARS = 2_000_000;
const SCRAPE_CACHE_TTL_DAYS = 180;
/** Cached pages of the brand's site read at most (all free). */
const MAX_CACHED_PAGES = 50;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class BrandNotFoundError extends Error {
  constructor(brandId: string) {
    super(`Brand ${brandId} not found`);
    this.name = 'BrandNotFoundError';
  }
}

/** The brand has no website, or none of its pages could be read: nobody can say. */
export class LinkedinPageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedinPageUnavailableError';
  }
}

export interface BrandLinkedinPageView {
  brandId: string;
  /** `not_computed` = never looked; `found` = `linkedinUrl` set; `not_found` = looked, its site links none. */
  status: 'not_computed' | 'found' | 'not_found';
  /** `https://www.linkedin.com/company/<slug>/`, or null. */
  linkedinUrl: string | null;
  discoveredAt: string | null;
  provenance: {
    method: 'brand_website_link';
    /** `brand_website` when found, null otherwise. */
    source: typeof LINKEDIN_SOURCE_BRAND_WEBSITE | null;
    /** The page of the brand's site the link was read on. */
    foundOnUrl: string | null;
    /** Every page of the brand's site that was read. */
    pagesRead: string[];
    /** brand-service run that paid for a scrape; null when every read was free. */
    runId: string | null;
  } | null;
}

async function loadBrand(brandId: string): Promise<{ name: string | null; domain: string | null; url: string | null }> {
  const [brand] = await db
    .select({ name: brands.name, domain: brands.domain, url: brands.url })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new BrandNotFoundError(brandId);
  return brand;
}

/** The stored answer. Never computes. Throws `BrandNotFoundError` for an unknown brand. */
export async function readBrandLinkedinPage(brandId: string): Promise<BrandLinkedinPageView> {
  await loadBrand(brandId);
  const [row] = await db
    .select()
    .from(brandLinkedinPages)
    .where(eq(brandLinkedinPages.brandId, brandId))
    .limit(1);
  if (!row) {
    return { brandId, status: 'not_computed', linkedinUrl: null, discoveredAt: null, provenance: null };
  }
  return {
    brandId,
    status: row.linkedinUrl ? 'found' : 'not_found',
    linkedinUrl: row.linkedinUrl,
    discoveredAt: row.discoveredAt,
    provenance: {
      method: 'brand_website_link',
      source: row.linkedinUrl ? LINKEDIN_SOURCE_BRAND_WEBSITE : null,
      foundOnUrl: row.foundOnUrl,
      pagesRead: row.pagesRead,
      runId: row.runId,
    },
  };
}

// ─── Discover ───────────────────────────────────────────────────────────────

export interface SitePage {
  url: string;
  content: string;
}

export interface BrandSiteReader {
  /** Free plain-HTTP read of a URL; null when it does not answer with a page. */
  fetchPage(url: string): Promise<string | null>;
  /** Pages of the brand's site already in the scrape cache (free). */
  cachedPages(domain: string): Promise<SitePage[]>;
  /** Paid, cached scrape. Only ever called with an org to bill. */
  scrapePage(url: string): Promise<string | null>;
}

/** Whether `url`'s host is on the registrable `domain` (subdomains included). Pure. */
export function isOnDomain(url: string, domain: string): boolean {
  try {
    return getDomain(new URL(url).hostname, { allowPrivateDomains: false }) === domain;
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HOMEPAGE_TIMEOUT_MS),
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
    return (await res.text()).slice(0, HOMEPAGE_MAX_CHARS);
  } catch {
    return null;
  }
}

async function cachedPages(domain: string): Promise<SitePage[]> {
  const rows = await db
    .select({ url: pageScrapeCache.url, content: pageScrapeCache.content })
    .from(pageScrapeCache)
    .where(and(like(pageScrapeCache.normalizedUrl, `%${domain}%`), gt(pageScrapeCache.expiresAt, sql`NOW()`)))
    .limit(MAX_CACHED_PAGES * 4);
  return rows.filter((r) => isOnDomain(r.url, domain)).slice(0, MAX_CACHED_PAGES);
}

function defaultReader(tracking: () => ScrapingTrackingContext | null): BrandSiteReader {
  return {
    fetchPage,
    cachedPages,
    async scrapePage(url: string) {
      const ctx = tracking();
      if (!ctx) throw new Error('[brand-service] scrapePage called with no org to bill');
      const content = await scrapeUrl(url, ctx);
      if (content) await upsertPageContent(url, content, SCRAPE_CACHE_TTL_DAYS);
      return content;
    },
  };
}

export interface LinkedinPageCaller {
  /** The org to bill a scrape to. Absent = only free reads. */
  orgId?: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
  audienceId?: string;
}

export interface DiscoverLinkedinPageOptions {
  brandId: string;
  caller: LinkedinPageCaller;
  /** Recompute even when a stored answer exists. Default: reuse it. */
  refresh?: boolean;
  /** Test seam for the website reads. */
  reader?: BrandSiteReader;
}

interface Search {
  linkedinUrl: string | null;
  foundOnUrl: string | null;
  pagesRead: string[];
  /** Whether any page of the site gave readable content. */
  readable: boolean;
}

/**
 * Read the brand's site cheapest first and stop at the first page linking its
 * own company page. `scrape` is called only when the free reads found nothing
 * and the homepage is not in the cache already. Exported for tests.
 */
export async function searchBrandSite(
  homepage: string,
  identity: { domain: string; name: string },
  reader: Pick<BrandSiteReader, 'fetchPage' | 'cachedPages'>,
  scrape: ((url: string) => Promise<string | null>) | null,
): Promise<Search> {
  const pagesRead: string[] = [];
  let readable = false;
  const tryPage = (url: string, content: string | null): string | null => {
    if (!content || content.trim().length === 0) return null;
    readable = true;
    if (!pagesRead.includes(url)) pagesRead.push(url);
    return extractLinkedinCompanyUrl(content, identity);
  };

  const plain = await reader.fetchPage(homepage);
  const fromPlain = tryPage(homepage, plain);
  if (fromPlain) return { linkedinUrl: fromPlain, foundOnUrl: homepage, pagesRead, readable };

  const cached = await reader.cachedPages(identity.domain);
  const homepageNormalized = homepage.replace(/\/+$/, '').replace('://www.', '://');
  let homepageCached = false;
  for (const page of cached) {
    if (page.url.replace(/\/+$/, '').replace('://www.', '://') === homepageNormalized) homepageCached = true;
    const found = tryPage(page.url, page.content);
    if (found) return { linkedinUrl: found, foundOnUrl: page.url, pagesRead, readable };
  }

  // A link injected client-side, or a homepage plain HTTP cannot read: one
  // rendered scrape, unless that very page is already cached (it would read
  // the same content again for money).
  if (scrape && !homepageCached) {
    const scraped = await scrape(homepage);
    const found = tryPage(homepage, scraped);
    if (found) return { linkedinUrl: found, foundOnUrl: homepage, pagesRead, readable };
  }

  return { linkedinUrl: null, foundOnUrl: null, pagesRead, readable };
}

/**
 * Find (or reuse) the brand's own LinkedIn company page. Reuses the stored
 * answer unless `refresh`, so calling it again costs nothing.
 */
export async function discoverBrandLinkedinPage(opts: DiscoverLinkedinPageOptions): Promise<BrandLinkedinPageView> {
  const { brandId, caller } = opts;
  const brand = await loadBrand(brandId);

  if (!opts.refresh) {
    const stored = await readBrandLinkedinPage(brandId);
    if (stored.status !== 'not_computed') return stored;
  }

  const domain = normalizeCompetitorDomain(brand.domain ?? brand.url);
  if (!domain) {
    throw new LinkedinPageUnavailableError(`Brand ${brandId} has no website to read its LinkedIn page from`);
  }
  const homepage = brand.url && isOnDomain(brand.url, domain) ? brand.url : `https://${domain}`;
  const identity = { domain, name: brand.name ?? domain.split('.')[0] };

  // A run is opened only if a paid scrape actually happens.
  let runId: string | null = null;
  const identityHeaders = () => ({
    orgId: caller.orgId!,
    userId: caller.userId,
    runId: runId ?? undefined,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
  });
  const reader = opts.reader ?? defaultReader(() => (caller.orgId ? { brandId, ...identityHeaders() } : null));

  const scrape = caller.orgId
    ? async (url: string) => {
        const cached = await getCachedPageContent(url);
        if (cached) return cached;
        const run = await createRun({
          orgId: caller.orgId!,
          userId: caller.userId,
          brandId,
          campaignId: caller.campaignId,
          featureSlug: caller.featureSlug,
          workflowSlug: caller.workflowSlug,
          audienceId: caller.audienceId,
          serviceName: 'brand-service',
          taskName: 'own-linkedin-page-discovery',
          parentRunId: caller.runId,
        });
        runId = run.id;
        try {
          const content = await reader.scrapePage(url);
          await updateRun(run.id, 'completed', identityHeaders());
          return content;
        } catch (error) {
          try {
            await updateRun(run.id, 'failed', identityHeaders());
          } catch (err) {
            console.warn(`[brand-service] Failed to mark own-linkedin-page run ${run.id} as failed:`, err);
          }
          throw error;
        }
      }
    : null;

  const search = await searchBrandSite(homepage, identity, reader, scrape);
  if (!search.readable) {
    throw new LinkedinPageUnavailableError(
      caller.orgId
        ? `Could not read any page of ${domain} to find its LinkedIn page`
        : `Could not read any page of ${domain} for free; send x-org-id to bill one scrape of its homepage`,
    );
  }

  const values = {
    brandId,
    linkedinUrl: search.linkedinUrl,
    linkedinSource: search.linkedinUrl ? LINKEDIN_SOURCE_BRAND_WEBSITE : null,
    pagesRead: search.pagesRead,
    foundOnUrl: search.foundOnUrl,
    requestedByOrgId: runId ? caller.orgId ?? null : null,
    runId,
    discoveredAt: new Date().toISOString(),
  };
  await db
    .insert(brandLinkedinPages)
    .values(values)
    .onConflictDoUpdate({ target: brandLinkedinPages.brandId, set: values });

  return readBrandLinkedinPage(brandId);
}
