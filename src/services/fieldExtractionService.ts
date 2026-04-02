/**
 * Generic field extraction service.
 *
 * Given a brand and a list of { key, description } fields, this service:
 * 1. Checks per-field cache (30-day TTL)
 * 2. For missing fields: scrapes the brand site → selects relevant URLs via chat-service → scrapes pages → extracts fields via chat-service
 * 3. Stores results in brand_extracted_fields
 *
 * Scraped page content and URL maps are persisted in DB-backed cache tables
 * (page_scrape_cache, url_map_cache) so they survive redeploys.
 * Default scrape cache TTL is 180 days; callers can override via scrapeCacheTtlDays.
 */

import { eq, and, gt, inArray, sql, isNull } from 'drizzle-orm';
import { db, brands, brandExtractedFields, pageScrapeCache, urlMapCache as urlMapCacheTable } from '../db';
import { chatComplete, TrackingHeaders } from '../lib/chat-client';
import {
  mapSiteUrls,
  scrapeUrl,
  ScrapingTrackingContext,
} from '../lib/scraping-client';
import { createRun, updateRun } from '../lib/runs-client';
import { getCampaignFeatureInputs } from '../lib/campaign-client';

const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_SCRAPE_CACHE_TTL_DAYS = 180; // 6 months

/** Show first 3 names then "+N more" for the rest */
export function formatFieldPreview(keys: string[], maxShown = 3): string {
  if (keys.length <= maxShown) return keys.join(', ');
  return `${keys.slice(0, maxShown).join(', ')} +${keys.length - maxShown} more`;
}

// ─── URL normalization ──────────────────────────────────────────────────────

export function normalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    // Lowercase host, remove www., remove trailing slash, keep path
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return urlStr.toLowerCase().replace(/\/+$/, '');
  }
}

// ─── DB-backed scrape cache ─────────────────────────────────────────────────

async function getCachedPageContent(url: string): Promise<string | null> {
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

async function upsertPageContent(url: string, content: string, ttlDays: number): Promise<void> {
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

/**
 * If the URL is on a subdomain (e.g. bnb.sortes.fun), return the root domain URL (https://sortes.fun).
 * Returns null if the URL is already a root domain or parsing fails.
 */
export function getRootDomainUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const parts = parsed.hostname.split('.');
    // Need at least 3 parts for a subdomain (e.g. sub.example.com)
    // Skip www as it's not a real subdomain
    if (parts.length < 3) return null;
    if (parts.length === 3 && parts[0] === 'www') return null;
    const rootDomain = parts.slice(-2).join('.');
    return `${parsed.protocol}//${rootDomain}`;
  } catch {
    return null;
  }
}

export interface FieldSpec {
  key: string;
  description: string;
}

export interface ExtractedFieldResult {
  key: string;
  value: unknown;
  cached: boolean;
  extractedAt: string;
  expiresAt: string | null;
  sourceUrls: string[] | null;
}

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
}

// ─── Field cache ─────────────────────────────────────────────────────────────

async function getCachedFields(
  brandId: string,
  fieldKeys: string[],
  campaignId?: string,
): Promise<Map<string, { value: unknown; extractedAt: string; expiresAt: string | null; sourceUrls: string[] | null }>> {
  if (fieldKeys.length === 0) return new Map();

  const campaignFilter = campaignId
    ? eq(brandExtractedFields.campaignId, campaignId)
    : isNull(brandExtractedFields.campaignId);

  const rows = await db
    .select()
    .from(brandExtractedFields)
    .where(
      and(
        eq(brandExtractedFields.brandId, brandId),
        inArray(brandExtractedFields.fieldKey, fieldKeys),
        gt(brandExtractedFields.expiresAt, sql`NOW()`),
        campaignFilter,
      ),
    );

  const map = new Map<string, { value: unknown; extractedAt: string; expiresAt: string | null; sourceUrls: string[] | null }>();
  for (const row of rows) {
    map.set(row.fieldKey, {
      value: row.fieldValue,
      extractedAt: row.extractedAt,
      expiresAt: row.expiresAt,
      sourceUrls: (row.sourceUrls as string[] | null) ?? null,
    });
  }
  return map;
}

// ─── URL selection via chat-service ─────────────────────────────────────────

async function selectRelevantUrls(
  allUrls: string[],
  fieldsDescription: string,
  tracking: TrackingHeaders,
  campaignContext: string | null,
): Promise<string[]> {
  if (allUrls.length <= 10) return allUrls;

  const contextBlock = campaignContext
    ? `\n\nCampaign context (use this to prioritize which pages are most relevant):\n${campaignContext}\n`
    : '';

  try {
    const result = await chatComplete(
      {
        systemPrompt:
          'You are a URL selection assistant. Given a list of website URLs and a description of fields to extract, select the TOP 10 most relevant pages. Return ONLY a JSON array of URLs.',
        message: `Select the 10 most relevant URLs for extracting these fields:\n${fieldsDescription}${contextBlock}\n\nURLs:\n${allUrls.slice(0, 100).map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nReturn a JSON array: ["url1", "url2", ...]`,
        provider: 'google',
        model: 'flash',
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 4096,
      },
      tracking,
    );

    if (result.json && Array.isArray(result.json)) {
      return (result.json as string[]).slice(0, 10);
    }

    // Fallback: parse from content
    const match = result.content.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).slice(0, 10);
  } catch (error: any) {
    console.error('[field-extraction] URL selection error:', error.message);
  }

  // Fallback: if AI selection fails, use first 10 URLs (homepage + top-level pages)
  return allUrls.slice(0, 10);
}

// ─── Field extraction via chat-service ──────────────────────────────────────

async function extractFieldsFromContent(
  pageContents: { url: string; content: string }[],
  fields: FieldSpec[],
  tracking: TrackingHeaders,
  campaignContext: string | null,
): Promise<Record<string, unknown>> {
  const combinedContent = pageContents
    .filter((p) => p.content)
    .map((p) => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 15000)}`)
    .join('\n\n');

  const fieldDescriptions = fields
    .map((f) => `- "${f.key}": ${f.description}`)
    .join('\n');

  const contextBlock = campaignContext
    ? `\n\nCampaign context (use this to guide and refine your extraction):\n${campaignContext}\n`
    : '';

  const result = await chatComplete(
    {
      systemPrompt:
        'You are a brand information extraction assistant. Analyze website content and extract the requested fields. Return ONLY valid JSON with the requested field keys.',
      message: `Analyze the following website content and extract these fields:\n\n${fieldDescriptions}${contextBlock}\n\nWebsite content:\n${combinedContent.substring(0, 100000)}\n\nReturn a JSON object with exactly these keys: ${fields.map((f) => `"${f.key}"`).join(', ')}. Use null if information is not found. For array fields, return arrays.`,
      provider: 'google',
      model: 'pro',
      responseFormat: 'json',
      temperature: 0,
      maxTokens: 24000,
      thinkingBudget: 8000,
    },
    tracking,
  );

  if (result.json) return result.json;

  const match = result.content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse AI response as JSON');
  return JSON.parse(match[0]);
}

// ─── Upsert results ─────────────────────────────────────────────────────────

async function upsertExtractedFields(
  brandId: string,
  fields: Array<{ key: string; value: unknown }>,
  sourceUrls: string[],
  campaignId?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  for (const field of fields) {
    if (campaignId) {
      await db
        .insert(brandExtractedFields)
        .values({
          brandId,
          fieldKey: field.key,
          fieldValue: field.value,
          sourceUrls,
          campaignId,
          extractedAt: sql`NOW()`,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [brandExtractedFields.brandId, brandExtractedFields.fieldKey, brandExtractedFields.campaignId],
          targetWhere: sql`${brandExtractedFields.campaignId} IS NOT NULL`,
          set: {
            fieldValue: field.value,
            sourceUrls,
            extractedAt: sql`NOW()`,
            expiresAt,
            updatedAt: sql`NOW()`,
          },
        });
    } else {
      await db
        .insert(brandExtractedFields)
        .values({
          brandId,
          fieldKey: field.key,
          fieldValue: field.value,
          sourceUrls,
          extractedAt: sql`NOW()`,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [brandExtractedFields.brandId, brandExtractedFields.fieldKey],
          targetWhere: sql`${brandExtractedFields.campaignId} IS NULL`,
          set: {
            fieldValue: field.value,
            sourceUrls,
            extractedAt: sql`NOW()`,
            expiresAt,
            updatedAt: sql`NOW()`,
          },
        });
    }
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export async function getBrand(brandId: string): Promise<Brand | null> {
  const result = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  return result[0] || null;
}

export interface ExtractFieldsOptions {
  brandId: string;
  fields: FieldSpec[];
  orgId: string;
  userId?: string;
  parentRunId: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
  scrapeCacheTtlDays?: number;
}

export async function extractFields(
  options: ExtractFieldsOptions,
): Promise<ExtractedFieldResult[]> {
  const { brandId, fields, orgId, userId, parentRunId, campaignId, featureSlug, brandIdHeader, workflowSlug } = options;
  const scrapeTtlDays = options.scrapeCacheTtlDays ?? DEFAULT_SCRAPE_CACHE_TTL_DAYS;

  const fieldKeys = fields.map((f) => f.key);

  // 1. Check cache (scoped by campaignId)
  const cached = await getCachedFields(brandId, fieldKeys, campaignId);
  const cachedResults: ExtractedFieldResult[] = [];
  const missingFields: FieldSpec[] = [];

  for (const field of fields) {
    const hit = cached.get(field.key);
    if (hit) {
      cachedResults.push({
        key: field.key,
        value: hit.value,
        cached: true,
        extractedAt: hit.extractedAt,
        expiresAt: hit.expiresAt,
        sourceUrls: hit.sourceUrls,
      });
    } else {
      missingFields.push(field);
    }
  }

  // Log cache results
  if (cachedResults.length > 0 && missingFields.length === 0) {
    console.log(`[${brandId}] All ${cachedResults.length} fields served from cache (keys: ${cachedResults.map(r => r.key).join(', ')})`);
    return cachedResults;
  } else if (cachedResults.length > 0) {
    console.log(`[${brandId}] Field cache: ${cachedResults.length} cached, ${missingFields.length} need extraction (missing: ${missingFields.map(f => f.key).join(', ')})`);
  } else {
    console.log(`[${brandId}] Field cache: 0/${fields.length} cached, extracting all`);
  }

  // 2. Need extraction — look up brand
  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.url) throw new Error('Brand has no URL');

  // Create run
  const run = await createRun({
    orgId,
    userId,
    brandId,
    campaignId,
    serviceName: 'brand-service',
    taskName: 'field-extraction',
    parentRunId,
    workflowSlug,
  });

  const tracking: TrackingHeaders = {
    orgId,
    userId,
    runId: run.id,
    campaignId,
    featureSlug,
    brandId: brandIdHeader,
    workflowSlug,
  };

  const scrapingTracking: ScrapingTrackingContext = {
    brandId,
    orgId,
    userId,
    workflowSlug,
    campaignId,
    featureSlug,
    brandIdHeader,
    runId: run.id,
  };

  try {
    // 2b. Fetch campaign context for LLM enrichment
    const featureInputs = await getCampaignFeatureInputs(campaignId, { orgId, userId, runId: run.id });
    const campaignContext = featureInputs && Object.keys(featureInputs).length > 0
      ? JSON.stringify(featureInputs, null, 2)
      : null;
    if (campaignContext) {
      console.log(`[${brandId}] Using campaign context from campaign ${campaignId}`);
    }

    // 3. Map site URLs (DB-cached to survive redeploys)
    console.log(`[${brandId}] Mapping site URLs for: ${brand.url}`);
    let allUrls: string[];
    try {
      let primaryUrls: string[];
      const cachedMap = await getCachedUrlMap(brand.url);
      if (cachedMap) {
        console.log(`[${brandId}] URL map cache hit for ${brand.url} (${cachedMap.length} URLs)`);
        primaryUrls = cachedMap;
      } else {
        primaryUrls = await mapSiteUrls(brand.url, scrapingTracking);
        await upsertUrlMap(brand.url, primaryUrls, scrapeTtlDays).catch((err) =>
          console.warn(`[${brandId}] Failed to cache URL map: ${err.message}`),
        );
      }

      const mapResults: string[][] = [primaryUrls];

      // If the brand URL is on a subdomain, also map the root domain
      const rootDomainUrl = getRootDomainUrl(brand.url);
      if (rootDomainUrl && rootDomainUrl !== brand.url) {
        const cachedRootMap = await getCachedUrlMap(rootDomainUrl);
        if (cachedRootMap) {
          console.log(`[${brandId}] URL map cache hit for root domain ${rootDomainUrl}`);
          mapResults.push(cachedRootMap);
        } else {
          console.log(`[${brandId}] Also mapping root domain: ${rootDomainUrl}`);
          try {
            const rootUrls = await mapSiteUrls(rootDomainUrl, scrapingTracking);
            await upsertUrlMap(rootDomainUrl, rootUrls, scrapeTtlDays).catch((err) =>
              console.warn(`[${brandId}] Failed to cache root URL map: ${err.message}`),
            );
            mapResults.push(rootUrls);
          } catch (err: any) {
            console.warn(`[${brandId}] Root domain mapping failed: ${err.message}`);
          }
        }
      }

      allUrls = [...new Set(mapResults.flat())];
      console.log(`[${brandId}] Found ${allUrls.length} unique URLs`);
    } catch (mapError: any) {
      console.warn(`[${brandId}] Site mapping failed, falling back to homepage only: ${mapError.message}`);
      allUrls = [brand.url];
    }
    if (allUrls.length === 0) allUrls = [brand.url];

    // 4. Select relevant URLs via chat-service
    const fieldsDescription = missingFields
      .map((f) => `- ${f.key}: ${f.description}`)
      .join('\n');

    console.log(`[${brandId}] Selecting relevant URLs...`);
    const selectedUrls = await selectRelevantUrls(allUrls, fieldsDescription, tracking, campaignContext);
    console.log(`[${brandId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);

    // 5. Scrape pages (DB-cached to survive redeploys)
    const urlsToScrape: string[] = [];
    const cachedPages: { url: string; content: string }[] = [];
    for (const url of selectedUrls) {
      const cachedContent = await getCachedPageContent(url);
      if (cachedContent) {
        cachedPages.push({ url, content: cachedContent });
      } else {
        urlsToScrape.push(url);
      }
    }
    if (cachedPages.length > 0) {
      console.log(`[${brandId}] Page cache hit for ${cachedPages.length}/${selectedUrls.length} URLs`);
    }
    if (urlsToScrape.length > 0) {
      console.log(`[${brandId}] Scraping ${urlsToScrape.length} pages (${cachedPages.length} cached)...`);
    } else {
      console.log(`[${brandId}] All ${selectedUrls.length} pages served from cache`);
    }
    const scrapePromises = urlsToScrape.map((url) =>
      scrapeUrl(url, scrapingTracking).then(async (content) => {
        if (content) {
          await upsertPageContent(url, content, scrapeTtlDays).catch((err) =>
            console.warn(`[${brandId}] Failed to cache page content for ${url}: ${err.message}`),
          );
        }
        return { url, content: content || '' };
      }),
    );
    const freshPages = await Promise.all(scrapePromises);
    const pageContents = [...cachedPages, ...freshPages];
    const successfulScrapes = pageContents.filter((p) => p.content);
    console.log(`[${brandId}] Successfully scraped ${successfulScrapes.length} pages`);

    if (successfulScrapes.length === 0) throw new Error('Failed to scrape any pages');

    // 6. Extract fields via chat-service
    console.log(`[${brandId}] Extracting ${missingFields.length} fields with AI (cache miss: ${formatFieldPreview(missingFields.map(f => f.key))})`);
    const extracted = await extractFieldsFromContent(
      successfulScrapes,
      missingFields,
      tracking,
      campaignContext,
    );

    // 7. Store results (with the URLs that were actually scraped)
    const scrapedSourceUrls = successfulScrapes.map((p) => p.url);
    const fieldsToStore = missingFields.map((f) => ({
      key: f.key,
      value: extracted[f.key] ?? null,
    }));
    await upsertExtractedFields(brandId, fieldsToStore, scrapedSourceUrls, campaignId);

    // 8. Complete run
    try {
      await updateRun(run.id, 'completed', { orgId, userId, runId: run.id, campaignId, featureSlug, brandIdHeader, workflowSlug });
    } catch (err) {
      console.warn(`[${brandId}] Failed to complete run ${run.id}:`, err);
    }

    // 9. Combine cached + fresh results
    const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();
    const now = new Date().toISOString();
    const freshResults: ExtractedFieldResult[] = missingFields.map((f) => ({
      key: f.key,
      value: extracted[f.key] ?? null,
      cached: false,
      extractedAt: now,
      expiresAt,
      sourceUrls: scrapedSourceUrls,
    }));

    return [...cachedResults, ...freshResults];
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', { orgId, userId, runId: run.id, campaignId, featureSlug, brandIdHeader, workflowSlug });
    } catch (err) {
      console.warn(`[${brandId}] Failed to mark run as failed:`, err);
    }
    throw error;
  }
}
