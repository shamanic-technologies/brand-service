/**
 * Shared scrape orchestration logic.
 *
 * Encapsulates: URL map cache → mapSiteUrls → root domain mapping →
 * page cache → scrapeUrl → store in cache.
 *
 * Used by both fieldExtractionService and imageExtractionService.
 */

import { eq, and, gt, sql } from 'drizzle-orm';
import { db, pageScrapeCache, urlMapCache as urlMapCacheTable } from '../db';
import {
  mapSiteUrls,
  scrapeUrl,
  ScrapingTrackingContext,
} from '../lib/scraping-client';
import { getRootDomainUrl, keepBrandDomainUrls, registrableDomain } from '../lib/brand-domain';

const DEFAULT_SCRAPE_CACHE_TTL_DAYS = 180;

// ─── URL normalization ──────────────────────────────────────────────────────

export function normalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return urlStr.toLowerCase().replace(/\/+$/, '');
  }
}

// ─── DB-backed scrape cache ─────────────────────────────────────────────────

export async function getCachedPageContent(url: string): Promise<string | null> {
  const normalized = normalizeUrl(url);
  const rows = await db
    .select({ content: pageScrapeCache.content })
    .from(pageScrapeCache)
    .where(
      and(
        eq(pageScrapeCache.normalizedUrl, normalized),
        gt(pageScrapeCache.expiresAt, sql`NOW()`),
      ),
    )
    .limit(1);
  return rows[0]?.content ?? null;
}

export async function upsertPageContent(url: string, content: string, ttlDays: number): Promise<void> {
  const normalized = normalizeUrl(url);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  await db
    .insert(pageScrapeCache)
    .values({
      url,
      normalizedUrl: normalized,
      content,
      scrapedAt: sql`NOW()`,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [pageScrapeCache.normalizedUrl],
      set: {
        url,
        content,
        scrapedAt: sql`NOW()`,
        expiresAt,
        updatedAt: sql`NOW()`,
      },
    });
}

async function getCachedUrlMap(siteUrl: string): Promise<string[] | null> {
  const normalized = normalizeUrl(siteUrl);
  const rows = await db
    .select({ urls: urlMapCacheTable.urls })
    .from(urlMapCacheTable)
    .where(
      and(
        eq(urlMapCacheTable.normalizedSiteUrl, normalized),
        eq(urlMapCacheTable.includesSubdomains, true),
        gt(urlMapCacheTable.expiresAt, sql`NOW()`),
      ),
    )
    .limit(1);
  return (rows[0]?.urls as string[] | undefined) ?? null;
}

async function upsertUrlMap(siteUrl: string, urls: string[], ttlDays: number): Promise<void> {
  const normalized = normalizeUrl(siteUrl);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  await db
    .insert(urlMapCacheTable)
    .values({
      siteUrl,
      normalizedSiteUrl: normalized,
      urls,
      includesSubdomains: true,
      mappedAt: sql`NOW()`,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [urlMapCacheTable.normalizedSiteUrl],
      set: {
        siteUrl,
        urls,
        includesSubdomains: true,
        mappedAt: sql`NOW()`,
        expiresAt,
        updatedAt: sql`NOW()`,
      },
    });
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export interface ScrapeOrchestratorOptions {
  brandUrl: string;
  brandId: string;
  scrapeTtlDays?: number;
  tracking: ScrapingTrackingContext;
}

export interface ScrapedPage {
  url: string;
  content: string;
}

/**
 * Map a brand's site URLs, then scrape selected pages.
 * All results are DB-cached for reuse across field/image extraction.
 *
 * @param selectedUrls - URLs to scrape (after LLM selection or all URLs if <= 10)
 */
export async function scrapeSelectedPages(
  selectedUrls: string[],
  brandId: string,
  scrapeTtlDays: number,
  tracking: ScrapingTrackingContext,
): Promise<ScrapedPage[]> {
  const urlsToScrape: string[] = [];
  const cachedPages: ScrapedPage[] = [];

  for (const url of selectedUrls) {
    const cachedContent = await getCachedPageContent(url);
    if (cachedContent) {
      cachedPages.push({ url, content: cachedContent });
    } else {
      urlsToScrape.push(url);
    }
  }

  if (cachedPages.length > 0) {
    console.log(`[brand-service] [${brandId}] Page cache hit for ${cachedPages.length}/${selectedUrls.length} URLs`);
  }
  if (urlsToScrape.length > 0) {
    console.log(`[brand-service] [${brandId}] Scraping ${urlsToScrape.length} pages (${cachedPages.length} cached)...`);
  } else {
    console.log(`[brand-service] [${brandId}] All ${selectedUrls.length} pages served from cache`);
  }

  const scrapePromises = urlsToScrape.map((url) =>
    scrapeUrl(url, tracking).then(async (content) => {
      if (content) {
        await upsertPageContent(url, content, scrapeTtlDays).catch((err) =>
          console.warn(`[brand-service] [${brandId}] Failed to cache page content for ${url}: ${err.message}`),
        );
      }
      return { url, content: content || '' };
    }),
  );

  const freshPages = await Promise.all(scrapePromises);
  return [...cachedPages, ...freshPages].filter((p) => p.content);
}

/**
 * Map all URLs for a brand site (with root domain fallback).
 * Results are DB-cached.
 */
export async function mapBrandUrls(
  brandUrl: string,
  brandId: string,
  scrapeTtlDays: number,
  tracking: ScrapingTrackingContext,
): Promise<string[]> {
  console.log(`[brand-service] [${brandId}] Mapping site URLs for: ${brandUrl}`);

  let allUrls: string[];
  try {
    let primaryUrls: string[];
    const cachedMap = await getCachedUrlMap(brandUrl);
    if (cachedMap) {
      console.log(`[brand-service] [${brandId}] URL map cache hit for ${brandUrl} (${cachedMap.length} URLs)`);
      primaryUrls = cachedMap;
    } else {
      primaryUrls = await mapSiteUrls(brandUrl, tracking);
      await upsertUrlMap(brandUrl, primaryUrls, scrapeTtlDays).catch((err) =>
        console.warn(`[brand-service] [${brandId}] Failed to cache URL map: ${err.message}`),
      );
    }

    const mapResults: string[][] = [primaryUrls];

    const rootDomainUrl = getRootDomainUrl(brandUrl);
    if (rootDomainUrl && rootDomainUrl !== brandUrl) {
      const cachedRootMap = await getCachedUrlMap(rootDomainUrl);
      if (cachedRootMap) {
        console.log(`[brand-service] [${brandId}] URL map cache hit for root domain ${rootDomainUrl}`);
        mapResults.push(cachedRootMap);
      } else {
        console.log(`[brand-service] [${brandId}] Also mapping root domain: ${rootDomainUrl}`);
        try {
          const rootUrls = await mapSiteUrls(rootDomainUrl, tracking);
          await upsertUrlMap(rootDomainUrl, rootUrls, scrapeTtlDays).catch((err) =>
            console.warn(`[brand-service] [${brandId}] Failed to cache root URL map: ${err.message}`),
          );
          mapResults.push(rootUrls);
        } catch (err: any) {
          console.warn(`[brand-service] [${brandId}] Root domain mapping failed: ${err.message}`);
        }
      }
    }

    // Firecrawl maps subdomains too; anything off the brand's registrable
    // domain (an external link, a CDN host) never becomes a candidate.
    allUrls = keepBrandDomainUrls([...new Set(mapResults.flat())], brandUrl);
    console.log(`[brand-service] [${brandId}] Found ${allUrls.length} unique URLs`);
  } catch (mapError: any) {
    console.warn(`[brand-service] [${brandId}] Site mapping failed, falling back to homepage only: ${mapError.message}`);
    allUrls = [brandUrl];
  }

  if (allUrls.length === 0) allUrls = [brandUrl];
  const probed = await probeWellKnownSubdomains({
    brandUrl, mappedUrls: allUrls, brandId, scrapeTtlDays, tracking,
  });
  return [...allUrls, ...probed];
}

// ─── Well-known subdomain probe ─────────────────────────────────────────────

/**
 * The subdomains where a brand keeps the facts a technical buyer checks.
 * Fixed on purpose: nothing outside this list is ever probed.
 */
export const WELL_KNOWN_SUBDOMAINS = ['docs', 'help', 'support', 'blog', 'developers'] as const;

/** Links kept per probed subdomain (depth 1: links of its root page only). */
export const MAX_LINKS_PER_SUBDOMAIN = 30;

const SUBDOMAIN_EXISTS_TIMEOUT_MS = 8000;

const NON_PAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|woff2?|ttf|mp4|webm)$/i;

/**
 * Page links on `host` found in a scraped page's markdown, in page order,
 * root first. Relative links resolve against `baseUrl`.
 */
export function extractSameHostLinks(markdown: string, baseUrl: string, host: string, cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.hostname.toLowerCase() !== host) return;
    if (NON_PAGE_EXTENSION.test(url.pathname)) return;
    url.hash = '';
    const key = normalizeUrl(url.toString());
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url.toString());
  };
  push(`https://${host}`);
  const linkPattern = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>/g;
  for (const m of markdown.matchAll(linkPattern)) {
    if (out.length >= cap) break;
    push(m[1] ?? m[2]);
  }
  return out.slice(0, cap);
}

/** True when the map already holds a page of `host` beyond its bare root. */
function mapCoversHost(mappedUrls: string[], host: string): boolean {
  return mappedUrls.some((u) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname.toLowerCase() === host && parsed.pathname.replace(/\/+$/, '') !== '';
    } catch {
      return false;
    }
  });
}

/**
 * Plain-HTTP existence check (no scraping credit). Returns the final URL when
 * the subdomain answers 200 on the brand's own registrable domain, else null.
 */
async function subdomainLanding(rootUrl: string, brandUrl: string, brandId: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(rootUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(SUBDOMAIN_EXISTS_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DistributeBot/1.0; +https://distribute.you)' },
    });
  } catch (err: any) {
    console.log(`[brand-service] [${brandId}] Subdomain probe ${rootUrl}: unreachable (${err?.cause?.code ?? err?.name ?? 'error'}: ${err?.message})`);
    return null;
  }
  res.body?.cancel().catch(() => {});
  const finalUrl = res.url || rootUrl;
  if (res.status !== 200) {
    console.log(`[brand-service] [${brandId}] Subdomain probe ${rootUrl}: HTTP ${res.status}, skipped`);
    return null;
  }
  if (keepBrandDomainUrls([finalUrl], brandUrl).length === 0) {
    console.log(`[brand-service] [${brandId}] Subdomain probe ${rootUrl}: redirects off the brand's domain to ${finalUrl}, skipped`);
    return null;
  }
  return finalUrl;
}

export interface ProbeSubdomainsOptions {
  brandUrl: string;
  /** URLs the site map already produced (after the brand-domain filter). */
  mappedUrls: string[];
  brandId: string;
  scrapeTtlDays: number;
  tracking: ScrapingTrackingContext;
  /** Ignore the cached root page of each subdomain and scrape it again. */
  resetCache?: boolean;
}

/**
 * The site map is index-based (sitemap + search index), not a crawler, so a
 * brand whose docs live on docs.<domain> with no sitemap and no server-side
 * link from the homepage never gets them mapped. For each well-known
 * subdomain the map did not already cover: check it exists over plain HTTP,
 * scrape its root once (cached in page_scrape_cache like any page), and keep
 * the links on that same host — depth 1, capped. Returns only URLs not already
 * in `mappedUrls`. A failed probe is logged and contributes nothing.
 */
export async function probeWellKnownSubdomains(opts: ProbeSubdomainsOptions): Promise<string[]> {
  const { brandUrl, mappedUrls, brandId, scrapeTtlDays, tracking, resetCache } = opts;
  const domain = registrableDomain(brandUrl);
  if (!domain) return [];
  let brandHost: string;
  try {
    brandHost = new URL(brandUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return [];
  }

  const perSubdomain = await Promise.all(
    WELL_KNOWN_SUBDOMAINS.map(async (sub): Promise<string[]> => {
      const host = `${sub}.${domain}`;
      if (host === brandHost) return [];
      if (mapCoversHost(mappedUrls, host)) {
        console.log(`[brand-service] [${brandId}] Subdomain ${host} already covered by the site map`);
        return [];
      }
      const rootUrl = `https://${host}`;
      try {
        let content = resetCache ? null : await getCachedPageContent(rootUrl);
        let baseUrl = rootUrl;
        if (!content) {
          const landing = await subdomainLanding(rootUrl, brandUrl, brandId);
          if (!landing) return [];
          baseUrl = landing;
          content = await scrapeUrl(landing, tracking);
          if (!content) {
            console.warn(`[brand-service] [${brandId}] Subdomain probe ${rootUrl}: scrape returned no content`);
            return [];
          }
          await upsertPageContent(rootUrl, content, scrapeTtlDays).catch((err) =>
            console.warn(`[brand-service] [${brandId}] Failed to cache page content for ${rootUrl}: ${err.message}`),
          );
        }
        const finalHost = new URL(baseUrl).hostname.toLowerCase();
        const links = extractSameHostLinks(content, baseUrl, finalHost, MAX_LINKS_PER_SUBDOMAIN);
        console.log(`[brand-service] [${brandId}] Subdomain ${host}: ${links.length} page(s) added as candidates`);
        return links;
      } catch (err: any) {
        console.warn(`[brand-service] [${brandId}] Subdomain probe ${rootUrl} failed: ${err.message}`);
        return [];
      }
    }),
  );

  const known = new Set(mappedUrls.map(normalizeUrl));
  const added: string[] = [];
  for (const url of perSubdomain.flat()) {
    const key = normalizeUrl(url);
    if (known.has(key)) continue;
    known.add(key);
    added.push(url);
  }
  return added;
}
