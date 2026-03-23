/**
 * Generic field extraction service.
 *
 * Given a brand and a list of { key, description } fields, this service:
 * 1. Checks per-field cache (30-day TTL)
 * 2. For missing fields: scrapes the brand site → selects relevant URLs via chat-service → scrapes pages → extracts fields via chat-service
 * 3. Stores results in brand_extracted_fields
 */

import { eq, and, gt, inArray, sql } from 'drizzle-orm';
import { db, brands, brandExtractedFields } from '../db';
import { chatComplete, TrackingHeaders } from '../lib/chat-client';
import {
  mapSiteUrls,
  scrapeUrl,
  ScrapingTrackingContext,
} from '../lib/scraping-client';
import { createRun, updateRun } from '../lib/runs-client';

const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

// ─── Cache ──────────────────────────────────────────────────────────────────

async function getCachedFields(
  brandId: string,
  fieldKeys: string[],
): Promise<Map<string, { value: unknown; extractedAt: string; expiresAt: string | null; sourceUrls: string[] | null }>> {
  if (fieldKeys.length === 0) return new Map();

  const rows = await db
    .select()
    .from(brandExtractedFields)
    .where(
      and(
        eq(brandExtractedFields.brandId, brandId),
        inArray(brandExtractedFields.fieldKey, fieldKeys),
        gt(brandExtractedFields.expiresAt, sql`NOW()`),
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
): Promise<string[]> {
  if (allUrls.length <= 10) return allUrls;

  try {
    const result = await chatComplete(
      {
        systemPrompt:
          'You are a URL selection assistant. Given a list of website URLs and a description of fields to extract, select the TOP 10 most relevant pages. Return ONLY a JSON array of URLs.',
        message: `Select the 10 most relevant URLs for extracting these fields:\n${fieldsDescription}\n\nURLs:\n${allUrls.slice(0, 100).map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nReturn a JSON array: ["url1", "url2", ...]`,
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 1024,
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

  return allUrls.slice(0, 10);
}

// ─── Field extraction via chat-service ──────────────────────────────────────

async function extractFieldsFromContent(
  pageContents: { url: string; content: string }[],
  fields: FieldSpec[],
  tracking: TrackingHeaders,
): Promise<Record<string, unknown>> {
  const combinedContent = pageContents
    .filter((p) => p.content)
    .map((p) => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 15000)}`)
    .join('\n\n');

  const fieldDescriptions = fields
    .map((f) => `- "${f.key}": ${f.description}`)
    .join('\n');

  const result = await chatComplete(
    {
      systemPrompt:
        'You are a brand information extraction assistant. Analyze website content and extract the requested fields. Return ONLY valid JSON with the requested field keys.',
      message: `Analyze the following website content and extract these fields:\n\n${fieldDescriptions}\n\nWebsite content:\n${combinedContent.substring(0, 100000)}\n\nReturn a JSON object with exactly these keys: ${fields.map((f) => `"${f.key}"`).join(', ')}. Use null if information is not found. For array fields, return arrays.`,
      responseFormat: 'json',
      temperature: 0,
      maxTokens: 4096,
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
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  for (const field of fields) {
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
  brandIdHeader?: string;
  workflowName?: string;
}

export async function extractFields(
  options: ExtractFieldsOptions,
): Promise<ExtractedFieldResult[]> {
  const { brandId, fields, orgId, userId, parentRunId, campaignId, brandIdHeader, workflowName } = options;

  const fieldKeys = fields.map((f) => f.key);

  // 1. Check cache
  const cached = await getCachedFields(brandId, fieldKeys);
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

  // All cached → return immediately
  if (missingFields.length === 0) {
    return cachedResults;
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
    workflowName,
  });

  const tracking: TrackingHeaders = {
    orgId,
    userId,
    runId: run.id,
    campaignId,
    brandId: brandIdHeader,
    workflowName,
  };

  const scrapingTracking: ScrapingTrackingContext = {
    brandId,
    orgId,
    userId,
    workflowName,
    campaignId,
    brandIdHeader,
    runId: run.id,
  };

  try {
    // 3. Map site URLs (subdomain + root domain in parallel)
    console.log(`[${brandId}] Mapping site URLs for: ${brand.url}`);
    let allUrls: string[];
    try {
      const mapPromises: Promise<string[]>[] = [mapSiteUrls(brand.url, scrapingTracking)];

      // If the brand URL is on a subdomain, also map the root domain
      const rootDomainUrl = getRootDomainUrl(brand.url);
      if (rootDomainUrl && rootDomainUrl !== brand.url) {
        console.log(`[${brandId}] Also mapping root domain: ${rootDomainUrl}`);
        mapPromises.push(
          mapSiteUrls(rootDomainUrl, scrapingTracking).catch((err) => {
            console.warn(`[${brandId}] Root domain mapping failed: ${err.message}`);
            return [];
          }),
        );
      }

      const results = await Promise.all(mapPromises);
      allUrls = [...new Set(results.flat())];
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
    const selectedUrls = await selectRelevantUrls(allUrls, fieldsDescription, tracking);
    console.log(`[${brandId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);

    // 5. Scrape pages
    console.log(`[${brandId}] Scraping ${selectedUrls.length} pages...`);
    const scrapePromises = selectedUrls.map((url) =>
      scrapeUrl(url, scrapingTracking).then((content) => ({ url, content: content || '' })),
    );
    const pageContents = await Promise.all(scrapePromises);
    const successfulScrapes = pageContents.filter((p) => p.content);
    console.log(`[${brandId}] Successfully scraped ${successfulScrapes.length} pages`);

    if (successfulScrapes.length === 0) throw new Error('Failed to scrape any pages');

    // 6. Extract fields via chat-service
    console.log(`[${brandId}] Extracting ${missingFields.length} fields with AI...`);
    const extracted = await extractFieldsFromContent(
      successfulScrapes,
      missingFields,
      tracking,
    );

    // 7. Store results (with the URLs that were actually scraped)
    const scrapedSourceUrls = successfulScrapes.map((p) => p.url);
    const fieldsToStore = missingFields.map((f) => ({
      key: f.key,
      value: extracted[f.key] ?? null,
    }));
    await upsertExtractedFields(brandId, fieldsToStore, scrapedSourceUrls);

    // 8. Complete run
    try {
      await updateRun(run.id, 'completed', { orgId, userId, runId: run.id, campaignId, brandIdHeader, workflowName });
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
      await updateRun(run.id, 'failed', { orgId, userId, runId: run.id, campaignId, brandIdHeader, workflowName });
    } catch (err) {
      console.warn(`[${brandId}] Failed to mark run as failed:`, err);
    }
    throw error;
  }
}
