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

import crypto from 'crypto';
import { eq, and, gt, inArray, sql, isNull, asc } from 'drizzle-orm';
import { db, brands, brandExtractedFields, orgBrands, pageScrapeCache, urlMapCache as urlMapCacheTable } from '../db';
import { chat, Caller, OrgCaller } from '../lib/chat-client';
import {
  mapSiteUrls,
  scrapeUrl,
  ScrapingTrackingContext,
} from '../lib/scraping-client';
import { createRun, updateRun } from '../lib/runs-client';
import { getCampaignFeatureInputs } from '../lib/campaign-client';
import { traceEvent } from '../lib/trace-event';
import { brandProfileService } from './brandProfileService';
import { buildProfileContextBlock } from './profileContext';
import { getBrandBusinessContext } from './brandBusinessContextService';

const CACHE_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const DEFAULT_SCRAPE_CACHE_TTL_DAYS = 180; // 6 months

// Business context (pasted when a brand has no website) is fed to the LLM through
// the SAME extractFieldsFromContent path as scraped pages, which caps each "page"
// at 100k chars. Chunk the pasted text into ≤100k-char segments so nothing is
// sliced — worst case ~1MB ≈ 10 chunks, well within Gemini's context window.
const BUSINESS_CONTEXT_CHUNK_CHARS = 100000;

/** Split pasted business context into ≤100k-char chunks (never empty). */
export function chunkBusinessContext(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += BUSINESS_CONTEXT_CHUNK_CHARS) {
    chunks.push(text.slice(i, i + BUSINESS_CONTEXT_CHUNK_CHARS));
  }
  return chunks.length > 0 ? chunks : [text];
}

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

export type UrlStrategy = 'url_map' | 'landing';

/**
 * Extraction behavior selector.
 * - `extract` (default): site-grounded extraction; returns "Unknown"/["Unknown"]
 *   when the info is absent. Byte-identical to the pre-mode behavior.
 * - `suggest`: generative best-effort — flips the prompt to an Alex-Hormozi +
 *   top-3-industry-expert persona that always produces a plausible value and
 *   NEVER returns "Unknown"/empty (see extractFieldsFromContent).
 */
export type ExtractionMode = 'extract' | 'suggest';

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
  orgId: string;
}

// ─── Field cache ─────────────────────────────────────────────────────────────

/**
 * Stable md5 hash of a field description. Used as part of the cache key so
 * the same `field_key` with different prompt descriptions resolves to
 * different cache slots — two callers asking for `industry` with different
 * extraction prompts do not pollute each other's cached value.
 *
 * `mode` also participates in the key so `extract` and `suggest` NEVER collide:
 * the two modes can produce different values for the same (field, description),
 * so a suggest result must never be served to an extract request or vice-versa.
 * `extract` hashes the raw description (byte-identical to the pre-mode key, so
 * every existing `brand_extracted_fields` slot stays valid after deploy);
 * `suggest` salts the input, yielding a disjoint hash space.
 */
export function hashFieldDescription(
  description: string,
  mode: ExtractionMode = 'extract',
): string {
  const input = mode === 'suggest' ? `mode:suggest ${description}` : description;
  return crypto.createHash('md5').update(input).digest('hex');
}

async function getCachedFields(
  brandId: string,
  fields: FieldSpec[],
  mode: ExtractionMode,
  campaignId?: string,
): Promise<Map<string, { value: unknown; extractedAt: string; expiresAt: string | null; sourceUrls: string[] | null }>> {
  if (fields.length === 0) return new Map();

  const campaignFilter = campaignId
    ? eq(brandExtractedFields.campaignId, campaignId)
    : isNull(brandExtractedFields.campaignId);

  // Expected (key → description hash) from the request. Within a single
  // request each field_key appears at most once, so the map is unambiguous.
  // The hash includes `mode`, so a suggest request never matches an extract row.
  const expectedHashByKey = new Map<string, string>(
    fields.map((f) => [f.key, hashFieldDescription(f.description, mode)]),
  );

  const rows = await db
    .select()
    .from(brandExtractedFields)
    .where(
      and(
        eq(brandExtractedFields.brandId, brandId),
        inArray(brandExtractedFields.fieldKey, fields.map((f) => f.key)),
        inArray(brandExtractedFields.fieldDescriptionHash, Array.from(expectedHashByKey.values())),
        gt(brandExtractedFields.expiresAt, sql`NOW()`),
        campaignFilter,
      ),
    );

  const map = new Map<string, { value: unknown; extractedAt: string; expiresAt: string | null; sourceUrls: string[] | null }>();
  for (const row of rows) {
    // Only accept the row when its (key, description hash) matches the request.
    if (expectedHashByKey.get(row.fieldKey) !== row.fieldDescriptionHash) continue;
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
  chatCaller: Caller,
  campaignContext: string | null,
): Promise<string[]> {
  if (allUrls.length <= 10) return allUrls;

  const contextBlock = campaignContext
    ? `\n\nCampaign context (use this to prioritize which pages are most relevant):\n${campaignContext}\n`
    : '';

  const result = await chat(
    {
      systemPrompt:
        'You are a URL selection assistant. Given a list of website URLs and a description of fields to extract, select the TOP 10 most relevant pages. Return ONLY a JSON object with a "urls" key containing an array of URL strings. If no URL is relevant to the requested fields, return {"urls":[]}.',
      message: `Select the 10 most relevant URLs for extracting these fields:\n${fieldsDescription}${contextBlock}\n\nURLs:\n${allUrls.slice(0, 100).map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\nReturn a JSON object: {"urls": ["url1", "url2", ...]}. If none are relevant, return {"urls":[]}.`,
      provider: 'google',
      model: 'flash',
      responseFormat: 'json',
      temperature: 0,
      maxTokens: 4096,
    },
    chatCaller,
  );

  try {
    if (result.json !== null && result.json !== undefined) {
      return normalizeSelectedUrls(result.json);
    }

    const objectMatch = result.content.match(/\{[\s\S]*\}/);
    if (objectMatch) return normalizeSelectedUrls(JSON.parse(objectMatch[0]));

    const arrayMatch = result.content.match(/\[[\s\S]*\]/);
    if (arrayMatch) return normalizeSelectedUrls(JSON.parse(arrayMatch[0]));
  } catch (error: any) {
    throw new Error(`[brand-service] URL selection failed: ${error.message}`);
  }

  throw new Error('[brand-service] URL selection failed: response did not contain a JSON urls array');
}

function normalizeSelectedUrls(value: unknown): string[] {
  const urls = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { urls?: unknown }).urls)
      ? (value as { urls: unknown[] }).urls
      : null;

  if (!urls) {
    throw new Error('response did not contain a "urls" array');
  }

  const invalidUrl = urls.find((url) => typeof url !== 'string');
  if (invalidUrl !== undefined) {
    throw new Error(`response contained a non-string URL: ${JSON.stringify(invalidUrl)}`);
  }

  return (urls as string[]).slice(0, 10);
}

// ─── Structured-output schema ───────────────────────────────────────────────

/**
 * Build a Gemini-compatible JSON `responseSchema` for a set of extraction field
 * keys. Each value may be a string ("Unknown") or an array of strings
 * (["Unknown"]) — matching the extraction prompt's contract — and every key is
 * `required`, so the provider enforces a complete object and stops emitting
 * truncated/malformed JSON mid-output on large multi-field (19+) extractions.
 * This is the real robustness fix for the chat-service 502
 * ("Model returned malformed or truncated JSON") on free-form JSON output.
 *
 * NOTE: deliberately NO `additionalProperties: false` — that is the Anthropic
 * strict-schema dialect; Gemini rejects it with HTTP 400. These calls all use
 * provider: 'google'.
 */
export function buildFieldsResponseSchema(keys: string[]): Record<string, unknown> {
  const valueSchema = {
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
  };
  const properties: Record<string, unknown> = {};
  for (const key of keys) properties[key] = valueSchema;
  return { type: 'object', properties, required: [...keys] };
}

// ─── Field extraction via chat-service ──────────────────────────────────────

export async function extractFieldsFromContent(
  pageContents: { url: string; content: string }[],
  fields: FieldSpec[],
  chatCaller: Caller,
  campaignContext: string | null,
  profileContext: string | null,
  urlStrategy: UrlStrategy,
  mode: ExtractionMode = 'extract',
): Promise<Record<string, unknown>> {
  // Per-page cap is generous (100k chars ≈ 25k tokens) so services listed lower
  // on a long landing/pricing page still reach the model. Page counts are
  // bounded (landing = 1 page, url_map ≤ 10), so worst case url_map is
  // ~10 × 100k = ~1M chars, which fits Gemini's context. No global combined cap.
  const combinedContent = pageContents
    .filter((p) => p.content)
    .map((p) => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 100000)}`)
    .join('\n\n');

  const fieldDescriptions = fields
    .map((f) => `- "${f.key}": ${f.description}`)
    .join('\n');

  // Priority order in the prompt: campaign context > validated brand profile >
  // scraped website content. The campaign block is tagged HIGHEST PRIORITY so it
  // overrides both the profile and the website; the profile block (built in
  // profileContext.ts) is the client-validated source of truth that overrides
  // the website unless the website explicitly contradicts it.
  const profileBlock = profileContext ?? '';
  const contextBlock = campaignContext
    ? `\n\nCampaign context (HIGHEST PRIORITY — overrides both the brand profile and the website content; use it to guide and refine your extraction):\n${campaignContext}\n`
    : '';

  // Model by strategy: a single landing page (onboarding "what services do you
  // offer", name fill) uses flash-pro (Gemini 3.5 Flash) — the discrimination
  // between genuinely-sellable paid services and internal process steps needs
  // judgment, and flash was too weak for it. `disableThinking: true` floors
  // Gemini 3 thinking to "minimal" (cheap + fast), which is what we want here;
  // do NOT remove it — that would default Gemini 3.5 Flash to HIGH thinking.
  // The url_map full-profile extraction keeps Pro (and chat-service's default
  // bounded thinking) for depth.
  //
  // A strict responseSchema is sent on BOTH paths so the provider enforces the
  // output shape server-side — this is what stops Gemini Pro from emitting
  // malformed/truncated JSON on the 19-field url_map extraction (chat-service
  // 502 "Model returned malformed or truncated JSON"). `thinkingBudget` was
  // dead config — chat-service /complete never honored it (only `disableThinking`).
  const modelParams =
    urlStrategy === 'landing'
      ? { model: 'flash-pro' as const, maxTokens: 24000, disableThinking: true }
      : { model: 'pro' as const, maxTokens: 24000 };

  const responseSchema = buildFieldsResponseSchema(fields.map((f) => f.key));

  // Server-computed current date so the model has a clock. Time-sensitive copy
  // on a site (deadlines, "shutting down on DATE", "ends soon", "limited time
  // until DATE") must only be surfaced as live urgency when its date is still in
  // the future. Without this the model echoes an already-passed deadline (e.g. a
  // "shutting down on December 9, 2024" note surfaced in 2026) as current urgency.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Two behaviors share the same content/schema/model/temperature and the same
  // date guard; only the persona + the missing-info contract differ:
  //  - extract (default): site-grounded, returns "Unknown"/["Unknown"] when the
  //    info is absent. BYTE-IDENTICAL to the pre-mode prompt.
  //  - suggest: an Alex-Hormozi + top-3-industry-expert persona that always
  //    writes a plausible best-effort value and NEVER returns "Unknown"/empty.
  const sourceNoun = pageContents.some((p) => p.url.startsWith('business-context://'))
    ? 'business context'
    : 'website content';

  let systemPrompt: string;
  let message: string;

  if (mode === 'suggest') {
    systemPrompt =
      `You are an elite brand offer strategist. Today's date is ${today}. ` +
      `Act as Alex Hormozi together with a panel of the top 3 experts in this brand's industry. ` +
      `For each requested field, write the single most logical, specific, and compelling answer, ` +
      `grounded in the scraped ${sourceNoun} plus any provided context. Where the source is silent on a field, ` +
      `infer the most sensible answer from what the business evidently does. ` +
      `NEVER return "Unknown", null, undefined, or empty values — always produce a best-effort answer for every field. ` +
      `Never fabricate absurd, false, or unverifiable claims: do not invent specific numbers, named customers, ` +
      `testimonials, awards, or guarantees that do not plainly exist. The user reviews and edits every output, ` +
      `so favor a strong, plausible draft over a hedge. For any time-sensitive or urgency claim (deadlines, ` +
      `countdowns, "shutting down on DATE", "ends soon", "limited time until DATE"), only treat it as current if ` +
      `its date is on or after ${today}; if a referenced deadline has already passed, do NOT present it as live ` +
      `urgency — instead infer a sensible current urgency/scarcity angle from the business rather than echoing the ` +
      `stale date. Return ONLY valid JSON with the requested field keys.`;
    message =
      `Write the most logical, specific, and compelling answer for each of these fields:\n\n` +
      `${fieldDescriptions}${profileBlock}${contextBlock}\n\n` +
      `Today's date is ${today}. Treat any time-sensitive or urgency claim as current ONLY if its date is on or ` +
      `after ${today}; if a deadline or countdown has already passed, do not present the stale date as live ` +
      `urgency — infer a sensible current angle instead.\n\n` +
      `${sourceNoun.charAt(0).toUpperCase()}${sourceNoun.slice(1)}:\n${combinedContent}\n\n` +
      `Return a JSON object with exactly these keys: ${fields.map((f) => `"${f.key}"`).join(', ')}. ` +
      `NEVER return "Unknown", null, undefined, or empty strings/arrays — always produce a best-effort value. ` +
      `Where the source is silent, infer the most sensible answer from the business (without fabricating absurd, ` +
      `false, or unverifiable specifics). For array fields, return arrays of strings.`;
  } else {
    systemPrompt = `You are a brand information extraction assistant. Today's date is ${today}. Analyze website content and extract the requested fields. Return ONLY valid JSON with the requested field keys. NEVER return null, undefined, or empty values — if information is not present in the content, return the string "Unknown" for string fields and ["Unknown"] for array fields. For any time-sensitive or urgency claim (deadlines, countdowns, "shutting down on DATE", "ends soon", "limited time until DATE"), only treat it as current if its date is on or after ${today}; if the referenced deadline has already passed, treat it as expired/stale and do NOT surface it as live urgency — return "Unknown" for that field instead of echoing the past-dated claim.`;
    message = `Analyze the following website content and extract these fields:\n\n${fieldDescriptions}${profileBlock}${contextBlock}\n\nToday's date is ${today}. Treat any time-sensitive or urgency claim as current ONLY if its date is on or after ${today}; if a deadline or countdown has already passed, treat it as expired and return "Unknown" for that field rather than presenting the stale deadline as live urgency.\n\nWebsite content:\n${combinedContent}\n\nReturn a JSON object with exactly these keys: ${fields.map((f) => `"${f.key}"`).join(', ')}. NEVER return null, undefined, or empty strings/arrays. If a field's information is not present in the content, return the string "Unknown" for that field. For array fields, return arrays of strings; if no values can be found, return ["Unknown"] (never an empty array).`;
  }

  const result = await chat(
    {
      systemPrompt,
      message,
      provider: 'google',
      responseFormat: 'json',
      responseSchema,
      temperature: 0,
      ...modelParams,
    },
    chatCaller,
  );

  if (result.json) return result.json;

  const match = result.content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse AI response as JSON');
  return JSON.parse(match[0]);
}

// ─── Upsert results ─────────────────────────────────────────────────────────

async function upsertExtractedFields(
  brandId: string,
  fields: Array<{ key: string; description: string; value: unknown }>,
  sourceUrls: string[],
  mode: ExtractionMode,
  campaignId?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  for (const field of fields) {
    const descriptionHash = hashFieldDescription(field.description, mode);
    if (campaignId) {
      await db
        .insert(brandExtractedFields)
        .values({
          brandId,
          fieldKey: field.key,
          fieldDescription: field.description,
          fieldDescriptionHash: descriptionHash,
          fieldValue: field.value,
          sourceUrls,
          campaignId,
          extractedAt: sql`NOW()`,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [brandExtractedFields.brandId, brandExtractedFields.fieldKey, brandExtractedFields.fieldDescriptionHash, brandExtractedFields.campaignId],
          targetWhere: sql`${brandExtractedFields.campaignId} IS NOT NULL`,
          set: {
            fieldDescription: field.description,
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
          fieldDescription: field.description,
          fieldDescriptionHash: descriptionHash,
          fieldValue: field.value,
          sourceUrls,
          extractedAt: sql`NOW()`,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [brandExtractedFields.brandId, brandExtractedFields.fieldKey, brandExtractedFields.fieldDescriptionHash],
          targetWhere: sql`${brandExtractedFields.campaignId} IS NULL`,
          set: {
            fieldDescription: field.description,
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

  if (result.length === 0) return null;
  // Platform-mode callers need an orgId for run tracking — pick the oldest
  // membership in org_brands. Returns '' when no org has claimed the brand
  // yet (rare; callers that need orgId will surface a clear failure).
  const membership = await db
    .select({ orgId: orgBrands.orgId })
    .from(orgBrands)
    .where(eq(orgBrands.brandId, brandId))
    .orderBy(asc(orgBrands.claimedAt))
    .limit(1);

  return { ...result[0], orgId: membership[0]?.orgId ?? '' };
}

export interface ExtractFieldsOptions {
  brandId: string;
  fields: FieldSpec[];
  /**
   * Identifies the upstream caller of brand-service.
   * - `mode: 'org'` (org-scoped routes): `caller.runId` is the upstream run id. extractFields
   *   creates its own brand-service run as a child of `caller.runId` and forwards its OWN
   *   run.id to chat-service as x-run-id.
   * - `mode: 'platform'` (internal routes): chat-service is hit via /internal/platform-complete
   *   with only x-api-key (no org/user/run tracking).
   */
  caller: Caller;
  scrapeCacheTtlDays?: number;
  resetCache?: boolean;
  urlStrategy?: UrlStrategy;
  /**
   * Extraction behavior. `extract` (default) = site-grounded, returns "Unknown"
   * when absent (byte-identical to pre-mode). `suggest` = generative best-effort
   * persona that never returns "Unknown". Modes use disjoint cache slots.
   */
  mode?: ExtractionMode;
  /**
   * Field keys to REGENERATE from scratch, ignoring what the user already
   * confirmed for them. For each listed key: the confirmed value is withheld
   * from the client-validated profile block injected into the prompt, and the
   * extraction cache is bypassed (the previously cached value was itself
   * produced from a prompt carrying that confirmed value, so serving it back
   * would return the user their own input again).
   *
   * Scoped ON PURPOSE: confirmed values for keys NOT listed here are still
   * injected as authoritative, so regenerating the offer levers still sees the
   * brand's confirmed `services`. Nothing is persisted or cleared here — the
   * `brand_user_fields` rows are untouched; only the ephemeral extract cache
   * slot for a regenerated key is refreshed with the new draft.
   */
  regenerateFieldKeys?: string[];
  /**
   * WHICH offer's confirmed fields ground the prompt. The 7 user-facing keys
   * belong to one proposition, so a brand selling two things has two different
   * right answers and only the caller knows which it means.
   *
   * Omitted → the brand's sole offer (byte-for-byte today's behaviour, and the
   * only case in production), nothing when the brand has none, and the
   * deliberate `SeveralOffersError` when it has several and nobody named one.
   * An id that names no offer of this (org, brand) is `OfferNotFoundError` —
   * never a quiet fall back to the brand's own rows.
   */
  offerId?: string | null;
}

export async function extractFields(
  options: ExtractFieldsOptions,
): Promise<ExtractedFieldResult[]> {
  const { brandId, fields, caller, resetCache } = options;
  const urlStrategy = options.urlStrategy ?? 'url_map';
  const mode: ExtractionMode = options.mode ?? 'extract';
  const regenerateKeys = new Set(options.regenerateFieldKeys ?? []);
  const scrapeTtlDays = options.scrapeCacheTtlDays ?? DEFAULT_SCRAPE_CACHE_TTL_DAYS;

  const campaignId = caller.mode === 'org' ? caller.campaignId : undefined;

  const fieldKeys = fields.map((f) => f.key);

  // 1. Check cache (scoped by campaignId) — skip entirely when resetCache is true
  const cachedResults: ExtractedFieldResult[] = [];
  let missingFields: FieldSpec[];

  if (resetCache) {
    console.log(`[brand-service] [${brandId}] resetCache=true — bypassing all caches, re-extracting ${fields.length} fields`);
    missingFields = fields;
  } else {
    const cached = await getCachedFields(brandId, fields, mode, campaignId);

    missingFields = [];
    for (const field of fields) {
      // A regenerated key never serves from cache: the cached value was extracted
      // under a prompt that carried the user's confirmed value as authoritative,
      // so returning it would hand the user back their own previous input.
      const hit = regenerateKeys.has(field.key) ? undefined : cached.get(field.key);
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
      console.log(`[brand-service] [${brandId}] All ${cachedResults.length} fields served from cache (keys: ${cachedResults.map(r => r.key).join(', ')})`);
      return cachedResults;
    } else if (cachedResults.length > 0) {
      console.log(`[brand-service] [${brandId}] Field cache: ${cachedResults.length} cached, ${missingFields.length} need extraction (missing: ${missingFields.map(f => f.key).join(', ')})`);
    } else {
      console.log(`[brand-service] [${brandId}] Field cache: 0/${fields.length} cached, extracting all`);
    }
  }

  // 2. Need extraction — look up brand and resolve the extraction SOURCE.
  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');

  // Source switch: a brand WITH a website scrapes+extracts from the site (as
  // before, unchanged). A brand with NO website extracts from its pasted
  // business context instead. `extractFields` reads `brand.url` fresh on every
  // call, so when a URL is added later the next post-cache-expiry extraction
  // naturally re-sources from the site — no new TTL/cron. Fail loud when a brand
  // has NEITHER source (no fabrication, no silent empty result).
  // Which org's configuration this extraction reads. Org mode uses the caller;
  // platform mode uses the brand's own org, exactly as the run tracking below
  // already does — the business context is that org's pasted text, not a
  // property of the shared brand identity.
  const configOrgId = caller.mode === 'org' ? caller.orgId : brand.orgId;
  const businessContext = brand.url ? null : await getBrandBusinessContext(configOrgId, brandId);
  if (!brand.url && !businessContext) {
    throw new Error(
      `Brand ${brandId} has neither a website URL nor pasted business context to extract from`,
    );
  }

  // Build the identity context used for tracking infrastructure (runs-service,
  // scraping-service, trace events). For org mode this comes from the caller.
  // For platform mode the brand's own orgId is used so the run still appears
  // under the right org's audit trail, with no user attribution.
  const trackingOrgId = configOrgId;
  const trackingUserId = caller.mode === 'org' ? caller.userId : undefined;
  const parentRunId = caller.mode === 'org' ? caller.runId : undefined;
  const campaignIdForRun = caller.mode === 'org' ? caller.campaignId : undefined;
  const featureSlug = caller.mode === 'org' ? caller.featureSlug : undefined;
  const brandIdHeader = caller.mode === 'org' ? caller.brandIdHeader : undefined;
  const workflowSlug = caller.mode === 'org' ? caller.workflowSlug : undefined;
  const audienceId = caller.mode === 'org' ? caller.audienceId : undefined;

  // Create run
  const run = await createRun({
    orgId: trackingOrgId,
    userId: trackingUserId,
    brandId,
    campaignId: campaignIdForRun,
    serviceName: 'brand-service',
    taskName: 'field-extraction',
    parentRunId,
    workflowSlug,
    audienceId,
  });

  // Chat caller for downstream chat-service calls. For org mode we swap
  // caller.runId (upstream run) for our own run.id so the chat-service run
  // becomes a child of THIS brand-service run.
  const chatCaller: Caller = caller.mode === 'org'
    ? { ...caller, runId: run.id } satisfies OrgCaller
    : { mode: 'platform' };

  const traceHeaders: Record<string, string | undefined> = {
    'x-org-id': trackingOrgId,
    'x-user-id': trackingUserId,
    'x-brand-id': brandIdHeader,
    'x-campaign-id': campaignIdForRun,
    'x-workflow-slug': workflowSlug,
    'x-feature-slug': featureSlug,
    'x-audience-id': audienceId,
  };

  traceEvent(run.id, {
    service: 'brand-service',
    event: 'field-extraction-start',
    detail: `Extracting ${missingFields.length} fields for brand ${brandId} (${brand.url ?? 'pasted business context'}): ${formatFieldPreview(missingFields.map(f => f.key))}`,
    level: 'info',
    data: { brandId, fieldCount: missingFields.length, cachedCount: cachedResults.length, url: brand.url, source: brand.url ? 'website' : 'business-context' },
  }, traceHeaders).catch(() => {});

  const scrapingTracking: ScrapingTrackingContext = {
    brandId,
    orgId: trackingOrgId,
    userId: trackingUserId,
    workflowSlug,
    campaignId: campaignIdForRun,
    featureSlug,
    brandIdHeader,
    audienceId,
    runId: run.id,
  };

  try {
    // 2b. Fetch campaign context for LLM enrichment
    const featureInputs = await getCampaignFeatureInputs(campaignIdForRun, { orgId: trackingOrgId, userId: trackingUserId, runId: run.id, audienceId });
    const campaignContext = featureInputs && Object.keys(featureInputs).length > 0
      ? JSON.stringify(featureInputs, null, 2)
      : null;
    if (campaignContext) {
      console.log(`[brand-service] [${brandId}] Using campaign context from campaign ${campaignIdForRun}`);
    }

    // 2c. Load the client-validated brand profile. Only injected as authoritative
    // context when a human has SAVED a profile version — the derived virtual-v1
    // (no saved version) is just our own past extractions, so injecting it would
    // feed the LLM its prior output and freeze earlier errors.
    //
    // A key the caller asked to REGENERATE is withheld from that block: the
    // caller means "write this again from the website", so showing the model
    // the confirmed value — under an instruction to prefer it — makes a new
    // draft impossible. Only the listed keys are withheld, so the rest of the
    // confirmed profile still grounds the regeneration (the offer levers are
    // written FROM the brand's confirmed services).
    //
    // WHICH offer's confirmed words are injected is the caller's to state: the
    // 7 user-facing keys describe one proposition, so on a brand selling two
    // things the wrong pick would ground this extraction in the other product's
    // promise and produce output nobody can see is wrong. `offerId` omitted
    // resolves the brand's sole offer, exactly as before.
    const profileResponse = await brandProfileService.getByBrandId(configOrgId, brandId, options.offerId);
    const confirmedForPrompt = regenerateKeys.size === 0
      ? profileResponse.confirmedFields
      : Object.fromEntries(
          Object.entries(profileResponse.confirmedFields).filter(([key]) => !regenerateKeys.has(key)),
        );
    const profileContext = buildProfileContextBlock({
      hasConfirmed: profileResponse.hasConfirmed,
      fields: confirmedForPrompt,
    });
    if (profileContext) {
      console.log(`[brand-service] [${brandId}] Injecting client-validated brand profile (${Object.keys(confirmedForPrompt).length} confirmed field(s))`);
    }
    if (regenerateKeys.size > 0) {
      console.log(`[brand-service] [${brandId}] Regenerating ${regenerateKeys.size} field(s) — confirmed values withheld from the prompt and cache bypassed: ${[...regenerateKeys].join(', ')}`);
    }

    const fieldsDescription = missingFields
      .map((f) => `- ${f.key}: ${f.description}`)
      .join('\n');

    // Content to feed the extractor — populated from EITHER the pasted business
    // context (no website) OR the scraped website pages (has website).
    let successfulScrapes: { url: string; content: string }[];

    if (!brand.url) {
      // ── SOURCE: pasted business context (brand has no website) ──
      // Chunk into ≤100k-char "pages" so extractFieldsFromContent's per-page cap
      // never slices the text; the synthetic source markers are never scraped.
      const chunks = chunkBusinessContext(businessContext!);
      successfulScrapes = chunks.map((content, i) => ({
        url: `business-context://${brandId}#${i + 1}`,
        content,
      }));
      console.log(`[brand-service] [${brandId}] No website; extracting ${missingFields.length} fields from pasted business context (${businessContext!.length} chars, ${chunks.length} chunk(s))`);
      traceEvent(run.id, {
        service: 'brand-service',
        event: 'business-context-source',
        detail: `Extracting ${missingFields.length} fields from pasted business context (${businessContext!.length} chars, ${chunks.length} chunk(s)) — brand has no website`,
        level: 'info',
        data: { brandId, chars: businessContext!.length, chunks: chunks.length },
      }, traceHeaders).catch(() => {});
    } else {
      // ── SOURCE: scraped website (unchanged behavior) ──
      const brandUrl: string = brand.url;
      let allUrls: string[] = [brandUrl];
      let selectedUrls: string[];

      if (urlStrategy === 'landing') {
        selectedUrls = [brandUrl];
        console.log(`[brand-service] [${brandId}] Using landing URL strategy; scraping only ${brandUrl}`);
        traceEvent(run.id, {
          service: 'brand-service',
          event: 'url-selection-complete',
          detail: `Landing URL strategy selected ${brandUrl}`,
          level: 'info',
          data: { brandId, urlStrategy, selectedUrls },
        }, traceHeaders).catch(() => {});
      } else {
        // 3. Map site URLs (DB-cached to survive redeploys)
        console.log(`[brand-service] [${brandId}] Mapping site URLs for: ${brandUrl}`);
        try {
          let primaryUrls: string[];
          const cachedMap = resetCache ? null : await getCachedUrlMap(brandUrl);
          if (cachedMap) {
            console.log(`[brand-service] [${brandId}] URL map cache hit for ${brandUrl} (${cachedMap.length} URLs)`);
            primaryUrls = cachedMap;
          } else {
            primaryUrls = await mapSiteUrls(brandUrl, scrapingTracking);
            await upsertUrlMap(brandUrl, primaryUrls, scrapeTtlDays).catch((err) =>
              console.warn(`[brand-service] [${brandId}] Failed to cache URL map: ${err.message}`),
            );
          }

          const mapResults: string[][] = [primaryUrls];

          // If the brand URL is on a subdomain, also map the root domain
          const rootDomainUrl = getRootDomainUrl(brandUrl);
          if (rootDomainUrl && rootDomainUrl !== brandUrl) {
            const cachedRootMap = resetCache ? null : await getCachedUrlMap(rootDomainUrl);
            if (cachedRootMap) {
              console.log(`[brand-service] [${brandId}] URL map cache hit for root domain ${rootDomainUrl}`);
              mapResults.push(cachedRootMap);
            } else {
              console.log(`[brand-service] [${brandId}] Also mapping root domain: ${rootDomainUrl}`);
              try {
                const rootUrls = await mapSiteUrls(rootDomainUrl, scrapingTracking);
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
          traceEvent(run.id, {
            service: 'brand-service',
            event: 'url-map-complete',
            detail: `Mapped ${allUrls.length} unique URLs for ${brandUrl}`,
            level: 'info',
            data: { urlCount: allUrls.length, brandUrl },
          }, traceHeaders).catch(() => {});
        } catch (mapError: any) {
          console.warn(`[brand-service] [${brandId}] Site mapping failed, falling back to homepage only: ${mapError.message}`);
          allUrls = [brandUrl];
        }
        if (allUrls.length === 0) allUrls = [brandUrl];

        // 4. Select relevant URLs via chat-service
        console.log(`[brand-service] [${brandId}] Selecting relevant URLs...`);
        selectedUrls = await selectRelevantUrls(allUrls, fieldsDescription, chatCaller, campaignContext);
        console.log(`[brand-service] [${brandId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);
      }

      // In suggest mode we must NEVER return "Unknown", so we can't take the
      // store-Unknown shortcut when URL selection finds nothing relevant. Fall
      // back to the landing page so the generative persona always has the
      // homepage to ground/infer from.
      if (selectedUrls.length === 0 && mode === 'suggest') {
        console.log(`[brand-service] [${brandId}] suggest mode + no relevant URLs — falling back to landing ${brandUrl}`);
        selectedUrls = [brandUrl];
      }

      if (selectedUrls.length === 0) {
        console.log(`[brand-service] [${brandId}] URL selection returned no relevant pages; storing Unknown for ${missingFields.length} fields`);

        traceEvent(run.id, {
          service: 'brand-service',
          event: 'url-selection-empty',
          detail: `No relevant URLs selected for ${missingFields.length} fields: ${formatFieldPreview(missingFields.map(f => f.key))}`,
          level: 'info',
          data: { brandId, fieldCount: missingFields.length, availableUrlCount: allUrls.length },
        }, traceHeaders).catch(() => {});

        const fieldsToStore = missingFields.map((f) => ({
          key: f.key,
          description: f.description,
          value: 'Unknown',
        }));
        await upsertExtractedFields(brandId, fieldsToStore, [], mode, campaignIdForRun);

        try {
          await updateRun(run.id, 'completed', { orgId: trackingOrgId, userId: trackingUserId, runId: run.id, campaignId: campaignIdForRun, featureSlug, brandIdHeader, workflowSlug, audienceId });
        } catch (err) {
          console.warn(`[brand-service] [${brandId}] Failed to complete run ${run.id}:`, err);
        }

        const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();
        const now = new Date().toISOString();
        const freshResults: ExtractedFieldResult[] = missingFields.map((f) => ({
          key: f.key,
          value: 'Unknown',
          cached: false,
          extractedAt: now,
          expiresAt,
          sourceUrls: [],
        }));

        traceEvent(run.id, {
          service: 'brand-service',
          event: 'field-extraction-complete',
          detail: `Completed with no relevant URLs: ${cachedResults.length} cached + ${freshResults.length} Unknown = ${cachedResults.length + freshResults.length} total fields`,
          level: 'info',
          data: { cached: cachedResults.length, extracted: freshResults.length, total: cachedResults.length + freshResults.length, sourceUrls: 0 },
        }, traceHeaders).catch(() => {});

        return [...cachedResults, ...freshResults];
      }

      // 5. Scrape pages (DB-cached to survive redeploys)
      const urlsToScrape: string[] = [];
      const cachedPages: { url: string; content: string }[] = [];
      for (const url of selectedUrls) {
        const cachedContent = resetCache ? null : await getCachedPageContent(url);
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
        scrapeUrl(url, scrapingTracking).then(async (content) => {
          if (content) {
            await upsertPageContent(url, content, scrapeTtlDays).catch((err) =>
              console.warn(`[brand-service] [${brandId}] Failed to cache page content for ${url}: ${err.message}`),
            );
          }
          return { url, content: content || '' };
        }),
      );
      const freshPages = await Promise.all(scrapePromises);
      const pageContents = [...cachedPages, ...freshPages];
      successfulScrapes = pageContents.filter((p) => p.content);
      console.log(`[brand-service] [${brandId}] Successfully scraped ${successfulScrapes.length} pages`);
      traceEvent(run.id, {
        service: 'brand-service',
        event: 'scrape-complete',
        detail: `Scraped ${successfulScrapes.length}/${selectedUrls.length} pages (${cachedPages.length} from cache, ${urlsToScrape.length} fresh)`,
        level: 'info',
        data: { scraped: successfulScrapes.length, total: selectedUrls.length, cached: cachedPages.length, fresh: urlsToScrape.length },
      }, traceHeaders).catch(() => {});

      if (successfulScrapes.length === 0) {
        const emptyUrls = pageContents
          .filter((p) => !p.content)
          .map((p) => p.url);
        throw new Error(
          `[brand-service] Failed to scrape any usable pages for brand ${brandId}: selected=${selectedUrls.length}, cached=${cachedPages.length}, fresh=${urlsToScrape.length}, empty=${emptyUrls.length}, urls=${emptyUrls.slice(0, 10).join(', ')}`,
        );
      }
    }

    // 6. Extract fields via chat-service
    console.log(`[brand-service] [${brandId}] Extracting ${missingFields.length} fields with AI (cache miss: ${formatFieldPreview(missingFields.map(f => f.key))})`);
    const extracted = await extractFieldsFromContent(
      successfulScrapes,
      missingFields,
      chatCaller,
      campaignContext,
      profileContext,
      urlStrategy,
      mode,
    );

    traceEvent(run.id, {
      service: 'brand-service',
      event: 'ai-extraction-complete',
      detail: `Extracted ${missingFields.length} fields via AI: ${formatFieldPreview(missingFields.map(f => f.key))}`,
      level: 'info',
      data: { extractedKeys: Object.keys(extracted) },
    }, traceHeaders).catch(() => {});

    // 7. Store results (with the URLs that were actually scraped)
    const scrapedSourceUrls = successfulScrapes.map((p) => p.url);
    const fieldsToStore = missingFields.map((f) => ({
      key: f.key,
      description: f.description,
      value: extracted[f.key] ?? null,
    }));
    await upsertExtractedFields(brandId, fieldsToStore, scrapedSourceUrls, mode, campaignIdForRun);

    // 8. Complete run
    try {
      await updateRun(run.id, 'completed', { orgId: trackingOrgId, userId: trackingUserId, runId: run.id, campaignId: campaignIdForRun, featureSlug, brandIdHeader, workflowSlug, audienceId });
    } catch (err) {
      console.warn(`[brand-service] [${brandId}] Failed to complete run ${run.id}:`, err);
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

    traceEvent(run.id, {
      service: 'brand-service',
      event: 'field-extraction-complete',
      detail: `Completed: ${cachedResults.length} cached + ${freshResults.length} extracted = ${cachedResults.length + freshResults.length} total fields`,
      level: 'info',
      data: { cached: cachedResults.length, extracted: freshResults.length, total: cachedResults.length + freshResults.length },
    }, traceHeaders).catch(() => {});

    return [...cachedResults, ...freshResults];
  } catch (error) {
    traceEvent(run.id, {
      service: 'brand-service',
      event: 'field-extraction-error',
      detail: `Field extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      level: 'error',
      data: { brandId, error: error instanceof Error ? error.message : String(error) },
    }, traceHeaders).catch(() => {});
    try {
      await updateRun(run.id, 'failed', { orgId: trackingOrgId, userId: trackingUserId, runId: run.id, campaignId: campaignIdForRun, featureSlug, brandIdHeader, workflowSlug, audienceId });
    } catch (err) {
      console.warn(`[brand-service] [${brandId}] Failed to mark run as failed:`, err);
    }
    throw error;
  }
}
