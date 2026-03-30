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

/**
 * If the URL is on a subdomain (e.g. bnb.sortes.fun), return the root domain URL.
 * Returns null if the URL is already a root domain or parsing fails.
 */
export function getRootDomainUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const parts = parsed.hostname.split('.');
    if (parts.length < 3) return null;
    if (parts.length === 3 && parts[0] === 'www') return null;
    const rootDomain = parts.slice(-2).join('.');
    return `${parsed.protocol}//${rootDomain}`;
  } catch {
    return null;
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
      mappedAt: sql`NOW()`,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [urlMapCacheTable.normalizedSiteUrl],
      set: {
        siteUrl,
        urls,
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

    allUrls = [...new Set(mapResults.flat())];
    console.log(`[brand-service] [${brandId}] Found ${allUrls.length} unique URLs`);
  } catch (mapError: any) {
    console.warn(`[brand-service] [${brandId}] Site mapping failed, falling back to homepage only: ${mapError.message}`);
    allUrls = [brandUrl];
  }

  if (allUrls.length === 0) allUrls = [brandUrl];
  return allUrls;
}
