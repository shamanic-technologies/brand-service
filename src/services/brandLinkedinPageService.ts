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
 * What is asked, cheapest first (owner 2026-10-07: "fait le moins cher"):
 *   1. the homepage over plain HTTP (free);
 *   2. every page of the brand's site already sitting in `page_scrape_cache`
 *      (free: the extraction paid for those scrapes already);
 *   3. Apollo's company record for the brand's domain, through apollo-service
 *      (`POST /internal/company-firmographics`: platform-billed, 1 credit only
 *      when Apollo knows the company, cached there 90d/30d, cost declared
 *      there). Kept only when the record is for that exact domain and its
 *      `linkedin_url` is a company page (`apolloLinkedinVerdict`). An Apollo
 *      error fails the discovery (502), never reads as "none";
 *   4. ONE scrape of the homepage through scraping-service, only when nothing
 *      above found a page, the homepage is not already cached, AND an org is in
 *      hand: scraping-service declares the cost, billed to that org on a
 *      brand-service run (child of `x-run-id`). With no org there is no one to
 *      bill, so the paid read is skipped.
 *
 * A PERSON can set the page (any member of an org that owns the brand, owner
 * 2026-10-07: "visualiser la page LinkedIn trouvée pour ma brand et la
 * changer"): `setBrandLinkedinPage`, source `user`. A set page wins over every
 * automatic source: discover returns it as stored even with `refresh`, and a
 * discover already running when it was set never overwrites it (the upsert
 * skips a `user` row). Clearing it (`clearBrandLinkedinPage`) deletes the row:
 * back to `not_computed`, the next discover decides automatically again.
 *
 * Found once, then reused: reads never compute, and discover returns the stored
 * answer unless `refresh`. No row = `not_computed`; a row with no URL =
 * `not_found`, a real answer, distinct from never having looked. A `not_found`
 * stored before Apollo was in the order (`apollo_asked_at` NULL) is decided
 * once more on the next discover: the free reads and Apollo's cache cost
 * nothing again, and a homepage already scraped is read from the cache.
 */

import { and, eq, gt, like, sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import { db, brands, brandLinkedinPages, pageScrapeCache } from '../db';
import { createRun, updateRun } from '../lib/runs-client';
import { scrapeUrl, type ScrapingTrackingContext } from '../lib/scraping-client';
import {
  apolloLinkedinVerdict,
  extractLinkedinCompanyUrl,
  parseLinkedinCompanyPageInput,
  type LinkedinPageInputRefusal,
  normalizeCompetitorDomain,
  type ApolloLinkedinOutcome,
  type ApolloLinkedinVerdict,
} from '../lib/competitor-linkedin';
import { lookupApolloCompany } from '../lib/apollo-client';
import { getCachedPageContent, upsertPageContent } from './scrapeOrchestrator';

/** Where a found URL came from. */
export const LINKEDIN_SOURCE_BRAND_WEBSITE = 'brand_website' as const;
export const LINKEDIN_SOURCE_APOLLO = 'apollo' as const;
/** Set by a person through the org route; wins over every automatic source. */
export const LINKEDIN_SOURCE_USER = 'user' as const;
export type LinkedinSource = typeof LINKEDIN_SOURCE_BRAND_WEBSITE | typeof LINKEDIN_SOURCE_APOLLO | typeof LINKEDIN_SOURCE_USER;

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
  /** Why a `not_found` is not found (says what was asked); null otherwise. */
  noneFoundReason: string | null;
  provenance: {
    /** How the stored answer was reached: `apollo_company_lookup` when Apollo found it, `set_by_user` when a person set it. */
    method: 'brand_website_link' | 'apollo_company_lookup' | 'set_by_user';
    /** `brand_website` | `apollo` | `user` when found, null otherwise. */
    source: LinkedinSource | null;
    /** Who set it and when; null unless `source` is `user`. */
    setBy: { userId: string | null; orgId: string | null; at: string | null } | null;
    /** The page of the brand's site the link was read on (site source only). */
    foundOnUrl: string | null;
    /** Every page of the brand's site that was read. */
    pagesRead: string[];
    /** brand-service run that paid for a scrape; null when every read was free. */
    runId: string | null;
    /** Apollo's company record by the brand's domain; `asked: false` = decided before Apollo was asked. */
    apollo: {
      asked: boolean;
      askedAt: string | null;
      outcome: ApolloLinkedinOutcome | null;
      /** Apollo's `linkedin_url`, verbatim. */
      linkedinUrl: string | null;
    };
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
    return { brandId, status: 'not_computed', linkedinUrl: null, discoveredAt: null, noneFoundReason: null, provenance: null };
  }
  const source = (row.linkedinSource as LinkedinSource | null) ?? null;
  return {
    brandId,
    status: row.linkedinUrl ? 'found' : 'not_found',
    linkedinUrl: row.linkedinUrl,
    discoveredAt: row.discoveredAt,
    noneFoundReason: row.linkedinUrl ? null : row.noneFoundReason,
    provenance: {
      method:
        source === LINKEDIN_SOURCE_USER
          ? 'set_by_user'
          : source === LINKEDIN_SOURCE_APOLLO
            ? 'apollo_company_lookup'
            : 'brand_website_link',
      source,
      setBy: source === LINKEDIN_SOURCE_USER ? { userId: row.setByUserId, orgId: row.setByOrgId, at: row.setAt } : null,
      foundOnUrl: row.foundOnUrl,
      pagesRead: row.pagesRead,
      runId: row.runId,
      apollo: {
        asked: row.apolloAskedAt !== null,
        askedAt: row.apolloAskedAt,
        outcome: (row.apolloOutcome as ApolloLinkedinOutcome | null) ?? null,
        linkedinUrl: row.apolloLinkedinUrl,
      },
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
  /** Test seam for the Apollo step. */
  apollo?: () => Promise<ApolloLinkedinVerdict>;
}

export interface Search {
  linkedinUrl: string | null;
  source: LinkedinSource | null;
  foundOnUrl: string | null;
  pagesRead: string[];
  /** Whether any page of the site gave readable content. */
  readable: boolean;
  /** Apollo's verdict; null when the site reads found the page first. */
  apollo: ApolloLinkedinVerdict | null;
}

export interface SearchSteps {
  /** Apollo's company record for the domain, as a verdict. Throws on failure. */
  apollo: () => Promise<ApolloLinkedinVerdict>;
  /** The paid homepage scrape; null when there is no org to bill. */
  scrape: ((url: string) => Promise<string | null>) | null;
}

/**
 * Ask cheapest first and stop at the first answer naming the brand's own
 * company page: the free site reads, then Apollo, then (`scrape`) the paid
 * homepage scrape, only when nothing found it and the homepage is not in the
 * cache already. Exported for tests.
 */
export async function searchBrandSite(
  homepage: string,
  identity: { domain: string; name: string },
  reader: Pick<BrandSiteReader, 'fetchPage' | 'cachedPages'>,
  steps: SearchSteps,
): Promise<Search> {
  const pagesRead: string[] = [];
  let readable = false;
  const tryPage = (url: string, content: string | null): string | null => {
    if (!content || content.trim().length === 0) return null;
    readable = true;
    if (!pagesRead.includes(url)) pagesRead.push(url);
    return extractLinkedinCompanyUrl(content, identity);
  };

  const fromSite = (linkedinUrl: string, foundOnUrl: string, apollo: ApolloLinkedinVerdict | null): Search => ({
    linkedinUrl,
    source: LINKEDIN_SOURCE_BRAND_WEBSITE,
    foundOnUrl,
    pagesRead,
    readable,
    apollo,
  });

  const plain = await reader.fetchPage(homepage);
  const fromPlain = tryPage(homepage, plain);
  if (fromPlain) return fromSite(fromPlain, homepage, null);

  const cached = await reader.cachedPages(identity.domain);
  const homepageNormalized = homepage.replace(/\/+$/, '').replace('://www.', '://');
  let homepageCached = false;
  for (const page of cached) {
    if (page.url.replace(/\/+$/, '').replace('://www.', '://') === homepageNormalized) homepageCached = true;
    const found = tryPage(page.url, page.content);
    if (found) return fromSite(found, page.url, null);
  }

  // Apollo's record for the domain: cheaper than a scrape, and free when Apollo
  // knows no company. Its errors propagate (fail loud, never "none").
  const apollo = await steps.apollo();
  if (apollo.linkedinUrl) {
    return { linkedinUrl: apollo.linkedinUrl, source: LINKEDIN_SOURCE_APOLLO, foundOnUrl: null, pagesRead, readable, apollo };
  }

  // A link injected client-side, or a homepage plain HTTP cannot read: one
  // rendered scrape, unless that very page is already cached (it would read
  // the same content again for money).
  if (steps.scrape && !homepageCached) {
    const scraped = await steps.scrape(homepage);
    const found = tryPage(homepage, scraped);
    if (found) return fromSite(found, homepage, apollo);
  }

  return { linkedinUrl: null, source: null, foundOnUrl: null, pagesRead, readable, apollo };
}

const APOLLO_OUTCOME_TEXT: Record<Exclude<ApolloLinkedinOutcome, 'linkedin_page'>, string> = {
  no_company: 'Apollo knows no company for it',
  no_linkedin_url: "Apollo's company record for it has no LinkedIn page",
  other_domain: "Apollo's company record answers for another domain",
  not_company_page: "Apollo's LinkedIn URL for it is not a company page",
};

/** Why nothing was found, naming every source asked. Pure. */
export function noneFoundReason(domain: string, search: Search, scraped: boolean): string {
  const site = `${domain} links no LinkedIn company page of its own (${search.pagesRead.length} page${search.pagesRead.length === 1 ? '' : 's'} read${scraped ? ', homepage scraped' : ''})`;
  const apollo =
    search.apollo && search.apollo.outcome !== 'linkedin_page'
      ? `Apollo was asked: ${APOLLO_OUTCOME_TEXT[search.apollo.outcome]}`
      : 'Apollo was not asked';
  return `${site}; ${apollo}.`;
}

/**
 * Find (or reuse) the brand's own LinkedIn company page. Reuses the stored
 * answer unless `refresh`, so calling it again costs nothing.
 */
export async function discoverBrandLinkedinPage(opts: DiscoverLinkedinPageOptions): Promise<BrandLinkedinPageView> {
  const { brandId, caller } = opts;
  const brand = await loadBrand(brandId);

  const stored = await readBrandLinkedinPage(brandId);
  // A page a person set is never recomputed, even on `refresh`.
  if (stored.provenance?.source === LINKEDIN_SOURCE_USER) return stored;
  if (!opts.refresh) {
    // A not_found decided before Apollo was in the order is decided once more.
    const decidedUnderOldOrder = stored.status === 'not_found' && !stored.provenance?.apollo.asked;
    if (stored.status !== 'not_computed' && !decidedUnderOldOrder) return stored;
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

  let apolloAskedAt: string | null = null;
  const askApollo = opts.apollo ?? (async () => apolloLinkedinVerdict(await lookupApolloCompany(domain), domain));
  const search = await searchBrandSite(homepage, identity, reader, {
    apollo: async () => {
      const verdict = await askApollo();
      apolloAskedAt = new Date().toISOString();
      return verdict;
    },
    scrape,
  });
  if (!search.linkedinUrl && !search.readable) {
    throw new LinkedinPageUnavailableError(
      caller.orgId
        ? `Could not read any page of ${domain} to find its LinkedIn page (Apollo found none either)`
        : `Could not read any page of ${domain} for free and Apollo found no LinkedIn page; send x-org-id to bill one scrape of its homepage`,
    );
  }

  const values = {
    brandId,
    linkedinUrl: search.linkedinUrl,
    linkedinSource: search.source,
    pagesRead: search.pagesRead,
    foundOnUrl: search.foundOnUrl,
    requestedByOrgId: runId ? caller.orgId ?? null : null,
    runId,
    discoveredAt: new Date().toISOString(),
    apolloAskedAt,
    apolloOutcome: search.apollo?.outcome ?? null,
    apolloLinkedinUrl: search.apollo?.answeredLinkedinUrl ?? null,
    noneFoundReason: search.linkedinUrl ? null : noneFoundReason(domain, search, runId !== null),
  };
  // A person may have set the page while this discovery ran: theirs wins.
  await db
    .insert(brandLinkedinPages)
    .values(values)
    .onConflictDoUpdate({
      target: brandLinkedinPages.brandId,
      set: values,
      setWhere: sql`${brandLinkedinPages.linkedinSource} IS DISTINCT FROM ${LINKEDIN_SOURCE_USER}`,
    });

  return readBrandLinkedinPage(brandId);
}

// ─── Set by a person ────────────────────────────────────────────────────────

/** The URL a person sent is not a LinkedIn company page; `message` is shown as is. */
export class InvalidLinkedinPageError extends Error {
  constructor(
    public readonly reason: LinkedinPageInputRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidLinkedinPageError';
  }
}

export interface SetLinkedinPageOptions {
  brandId: string;
  /** What the person typed or pasted. */
  linkedinUrl: unknown;
  orgId: string;
  /** Internal user id; null when the caller sent none. */
  userId: string | null;
}

/**
 * A person sets the brand's page: validated, stored canonical, source `user`.
 * Keeps what the automatic search learned (pages read, Apollo's answer) as
 * history. Throws `InvalidLinkedinPageError` (nothing stored) or `BrandNotFoundError`.
 */
export async function setBrandLinkedinPage(opts: SetLinkedinPageOptions): Promise<BrandLinkedinPageView> {
  const parsed = parseLinkedinCompanyPageInput(opts.linkedinUrl);
  if (!parsed.ok) throw new InvalidLinkedinPageError(parsed.reason, parsed.message);
  await loadBrand(opts.brandId);
  const now = new Date().toISOString();
  const set = {
    linkedinUrl: parsed.linkedinUrl,
    linkedinSource: LINKEDIN_SOURCE_USER,
    foundOnUrl: null,
    requestedByOrgId: null,
    runId: null,
    noneFoundReason: null,
    discoveredAt: now,
    setByUserId: opts.userId,
    setByOrgId: opts.orgId,
    setAt: now,
  };
  await db
    .insert(brandLinkedinPages)
    .values({ brandId: opts.brandId, ...set })
    .onConflictDoUpdate({ target: brandLinkedinPages.brandId, set });
  return readBrandLinkedinPage(opts.brandId);
}

/**
 * Clear the page a person set: the row goes, the brand is back to
 * `not_computed` and the next discover decides automatically. An automatic
 * answer is not cleared (nothing to undo). Throws `BrandNotFoundError`.
 */
export async function clearBrandLinkedinPage(brandId: string): Promise<BrandLinkedinPageView> {
  await loadBrand(brandId);
  await db
    .delete(brandLinkedinPages)
    .where(and(eq(brandLinkedinPages.brandId, brandId), eq(brandLinkedinPages.linkedinSource, LINKEDIN_SOURCE_USER)));
  return readBrandLinkedinPage(brandId);
}
