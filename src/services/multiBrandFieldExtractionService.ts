/**
 * Multi-brand field extraction service.
 *
 * Handles extracting fields from one or more brands. When multiple brands
 * are provided, produces both per-brand results and a consolidated view
 * across all brands.
 */

import crypto from 'crypto';
import { eq, gt, sql, and } from 'drizzle-orm';
import { extractFields, getBrand, buildFieldsResponseSchema, FieldSpec, ExtractedFieldResult, UrlStrategy, ExtractionMode } from './fieldExtractionService';
import { chat, Caller, OrgCaller, PlatformCaller } from '../lib/chat-client';
import { db, consolidatedFieldCache } from '../db';
import { getConfirmedByBrandId, isUserFacingFieldKey, ConfirmedUserField } from './brandUserFieldsService';

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
  orgId: string;
}

export interface MultiBrandExtractFieldsOptions {
  brandIds: string[];
  fields: FieldSpec[];
  /**
   * Brand-service caller — `OrgCaller` for `/orgs/brands/extract-fields`,
   * `PlatformCaller` for `/internal/brands/extract-fields`. The latter bypasses
   * org/user/run tracking and bills chat-service to the platform account.
   */
  caller: Caller;
  scrapeCacheTtlDays?: number;
  resetCache?: boolean;
  urlStrategy?: UrlStrategy;
  /**
   * Extraction behavior — `extract` (default, returns "Unknown" when absent) or
   * `suggest` (generative best-effort persona, never "Unknown"). Threaded to
   * every per-brand `extractFields` and the cross-brand consolidation prompt;
   * modes use disjoint cache slots.
   */
  mode?: ExtractionMode;
}

export interface BrandMeta {
  brandId: string;
  domain: string;
  name: string;
  // NULLABLE — a no-website brand has no URL (it extracts from pasted context).
  brandUrl: string | null;
}

export interface BrandFieldDetail {
  value: unknown;
  cached: boolean;
  extractedAt: string;
  expiresAt: string | null;
  sourceUrls: string[] | null;
}

/**
 * Provenance of a returned field value:
 * - `confirmed`: a user-facing field the user has validated (value = the confirmed value).
 * - `suggested`: a user-facing field NOT yet confirmed (value = the auto-extract prefill).
 * - `extracted`: a pure backend field (not user-facing).
 */
export type FieldProvenance = 'confirmed' | 'suggested' | 'extracted';

/** Unified response: always brands + { value, byBrand } per field + provenance map */
export interface MultiBrandFieldsResponse {
  brands: BrandMeta[];
  fields: Record<string, {
    value: unknown;
    byBrand: Record<string, BrandFieldDetail>;
  }>;
  /** Per requested field key → provenance tag (sibling to `fields`, additive). */
  provenance: Record<string, FieldProvenance>;
}

// ─── DB-backed consolidated fields cache ────────────────────────────────────
// Keyed by a deterministic hash of (sorted brand IDs + sorted field keys + campaignId + per-brand values).
// Persisted in the consolidated_field_cache table so it survives redeploys.

/** Build a deterministic cache key from inputs + per-brand values. */
function buildConsolidatedCacheKey(
  brandIds: string[],
  fieldKeys: string[],
  valuesByDomain: Record<string, Record<string, unknown>>,
  mode: ExtractionMode,
  campaignId?: string,
): string {
  const payload = JSON.stringify({
    brands: [...brandIds].sort(),
    fields: [...fieldKeys].sort(),
    campaign: campaignId ?? '',
    mode,
    values: Object.keys(valuesByDomain)
      .sort()
      .map((domain) => [domain, valuesByDomain[domain]]),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function getCachedConsolidated(key: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ fieldValues: consolidatedFieldCache.fieldValues })
    .from(consolidatedFieldCache)
    .where(
      and(
        eq(consolidatedFieldCache.cacheKey, key),
        gt(consolidatedFieldCache.expiresAt, sql`NOW()`),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return rows[0].fieldValues as Record<string, unknown>;
}

async function setCachedConsolidated(
  key: string,
  values: Record<string, unknown>,
  expiresAt: Date,
  brandIds: string[],
  fieldKeys: string[],
  campaignId?: string,
): Promise<void> {
  await db
    .insert(consolidatedFieldCache)
    .values({
      cacheKey: key,
      fieldValues: values,
      brandIds: brandIds,
      fieldKeys: fieldKeys,
      campaignId: campaignId ?? null,
      expiresAt: expiresAt.toISOString(),
    })
    .onConflictDoUpdate({
      target: [consolidatedFieldCache.cacheKey],
      set: {
        fieldValues: values,
        expiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
}

/**
 * Consolidate per-brand field values into a merged view using an LLM.
 */
async function consolidateFields(
  fieldKeys: string[],
  byBrand: Record<string, Record<string, unknown>>,
  chatCaller: Caller,
  mode: ExtractionMode = 'extract',
): Promise<Record<string, unknown>> {
  const perBrandSummary = Object.entries(byBrand)
    .map(([domain, fields]) => `Brand "${domain}":\n${JSON.stringify(fields, null, 2)}`)
    .join('\n\n');

  // In suggest mode the per-brand values are already best-effort (never
  // "Unknown"); the consolidation persona mirrors the per-brand one so the
  // merged view stays generative and never collapses to "Unknown".
  const systemPrompt =
    mode === 'suggest'
      ? 'You are an elite brand offer strategist consolidating field values across multiple brands. ' +
        'Act as Alex Hormozi with a panel of the top 3 experts in the brands’ industry. Produce a single ' +
        'merged view that is the most logical, specific, and compelling per field. NEVER return "Unknown", null, ' +
        'or empty values; never fabricate absurd, false, or unverifiable specifics. Return ONLY valid JSON with ' +
        'the requested field keys.'
      : 'You are a brand consolidation assistant. Given field values extracted from multiple brands, ' +
        'produce a single consolidated view that merges insights across all brands. ' +
        'Return ONLY valid JSON with the requested field keys.';

  const result = await chat(
    {
      systemPrompt,
      message:
        `Consolidate the following field values across multiple brands into a single merged view.\n\n` +
        `Fields to consolidate: ${fieldKeys.join(', ')}\n\n` +
        `Per-brand values:\n${perBrandSummary}\n\n` +
        `Return a JSON object with exactly these keys: ${fieldKeys.map((k) => `"${k}"`).join(', ')}. ` +
        `For each field, produce a consolidated value that combines insights from all brands. ` +
        `For string fields, write a merged summary. For array fields, merge and deduplicate. ` +
        `For object fields, merge sensibly.` +
        (mode === 'suggest'
          ? ` NEVER return "Unknown", null, or empty values — always produce a best-effort merged value.`
          : ''),
      provider: 'google',
      model: 'pro',
      responseFormat: 'json',
      // Strict schema enforces the output shape server-side so Gemini Pro can't
      // emit malformed/truncated JSON across the consolidated field set (same
      // chat-service 502 class as the per-brand extraction). `thinkingBudget`
      // was dead config — chat-service /complete never honored it.
      responseSchema: buildFieldsResponseSchema(fieldKeys),
      temperature: 0,
      maxTokens: 24000,
    },
    chatCaller,
  );

  if (result.json) return result.json;

  const match = result.content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse consolidation response as JSON');
  return JSON.parse(match[0]);
}

/**
 * Extract fields from one or more brands.
 *
 * Unified response format regardless of brand count:
 * { brands: [...], fields: { key: { value, byBrand } } }
 *
 * `value` = single brand's value (1 brand) or LLM-consolidated (N brands).
 * `byBrand` = per-brand values keyed by domain.
 */
export async function multiBrandExtractFields(
  options: MultiBrandExtractFieldsOptions,
): Promise<MultiBrandFieldsResponse> {
  const { brandIds, fields, caller, scrapeCacheTtlDays, resetCache, urlStrategy } = options;
  const mode: ExtractionMode = options.mode ?? 'extract';

  // Look up all brands first to validate and get domains
  const brandLookups = await Promise.all(brandIds.map((id) => getBrand(id)));
  const brandsMap = new Map<string, Brand>();

  for (let i = 0; i < brandIds.length; i++) {
    const brand = brandLookups[i];
    if (!brand) {
      throw new Error(`Brand not found: ${brandIds[i]}`);
    }
    brandsMap.set(brandIds[i], brand);
  }

  // Build brands metadata array. A brand WITH a website keys its per-brand result
  // on its domain; a no-website brand (url + domain both null, identified by name)
  // has no domain, so it keys on its brandId — a stable, unique fallback so the
  // byDomain/byBrand maps never collide. The "no website AND no pasted business
  // context → fail loud" gate lives in extractFields (the layer that reads the
  // business context), so we do NOT reject a null-url brand here.
  const brandsMeta: BrandMeta[] = brandIds.map((id) => {
    const brand = brandsMap.get(id)!;
    return {
      brandId: id,
      domain: brand.domain ?? id,
      name: brand.name || brand.domain || id,
      brandUrl: brand.url,
    };
  });

  // Extract fields for each brand in parallel
  const perBrandResults = await Promise.all(
    brandIds.map((brandId) =>
      extractFields({
        brandId,
        fields,
        caller,
        scrapeCacheTtlDays,
        resetCache,
        urlStrategy,
        mode,
      }),
    ),
  );

  // Build per-brand detail map (keyed by domain → fieldKey → full result)
  const fieldKeys = fields.map((f) => f.key);
  const byDomain: Record<string, Record<string, ExtractedFieldResult>> = {};
  // Also build a values-only map for LLM consolidation
  const valuesByDomain: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < brandIds.length; i++) {
    const domain = brandsMeta[i].domain;
    const brandResults = perBrandResults[i];

    const brandDetails: Record<string, ExtractedFieldResult> = {};
    const brandValues: Record<string, unknown> = {};
    for (const result of brandResults) {
      brandDetails[result.key] = result;
      brandValues[result.key] = result.value;
    }
    byDomain[domain] = brandDetails;
    valuesByDomain[domain] = brandValues;
  }

  // Determine `value` per field: direct value for single brand, LLM-consolidated for multiple
  let valueMap: Record<string, unknown>;

  if (brandIds.length === 1) {
    const domain = brandsMeta[0].domain;
    valueMap = { ...valuesByDomain[domain] };
  } else {
    // Check DB-backed consolidated cache — keyed by brand IDs + field keys + campaign + per-brand values
    const consolidationCampaignId = caller.mode === 'org' ? caller.campaignId : undefined;
    const cacheKey = buildConsolidatedCacheKey(brandIds, fieldKeys, valuesByDomain, mode, consolidationCampaignId);
    const cachedConsolidated = resetCache ? null : await getCachedConsolidated(cacheKey);

    if (cachedConsolidated) {
      console.log(`[brand-service] Consolidated fields cache hit for ${brandIds.length} brands`);
      valueMap = cachedConsolidated;
    } else {
      console.log(`[brand-service] Consolidating fields across ${brandIds.length} brands`);
      valueMap = await consolidateFields(fieldKeys, valuesByDomain, caller, mode);

      // Cache the consolidated result. Expires at the earliest per-brand expiry.
      const allExpiries = Object.values(byDomain)
        .flatMap((details) => Object.values(details))
        .map((d) => d.expiresAt ? new Date(d.expiresAt).getTime() : Infinity)
        .filter((t) => t !== Infinity);
      const minExpiry = allExpiries.length > 0 ? Math.min(...allExpiries) : Date.now() + 30 * 24 * 60 * 60 * 1000;

      await setCachedConsolidated(cacheKey, valueMap, new Date(minExpiry), brandIds, fieldKeys, consolidationCampaignId);
    }
  }

  // Build unified response with full metadata in byBrand
  const responseFields: Record<string, { value: unknown; byBrand: Record<string, BrandFieldDetail> }> = {};
  for (const key of fieldKeys) {
    const perBrand: Record<string, BrandFieldDetail> = {};
    for (const [domain, brandDetails] of Object.entries(byDomain)) {
      const detail = brandDetails[key];
      perBrand[domain] = detail
        ? { value: detail.value, cached: detail.cached, extractedAt: detail.extractedAt, expiresAt: detail.expiresAt, sourceUrls: detail.sourceUrls }
        : { value: null, cached: false, extractedAt: new Date().toISOString(), expiresAt: null, sourceUrls: null };
    }
    responseFields[key] = {
      value: valueMap[key] ?? null,
      byBrand: perBrand,
    };
  }

  // ── Confirmed (user-validated) overlay + provenance tagging ────────────────
  // For every requested key ∈ the 7 user-facing keys, overlay the per-brand
  // confirmed value (when present) and tag provenance. A user-facing key with a
  // confirmed value for EVERY brand in the request → `confirmed` (and for the
  // single-brand case the top-level `value` is overlaid too); a user-facing key
  // missing a confirmed value on any brand → `suggested` (value stays the
  // auto-extract prefill). Any non-user-facing key → `extracted`. The `fields`
  // values shape is unchanged — this is purely additive.
  const confirmedByBrandId = new Map<string, Map<string, ConfirmedUserField>>();
  await Promise.all(
    brandIds.map(async (id) => {
      // Which org's confirmed layer this reads: the caller in org mode, the
      // brand's own org in platform mode — same rule the extraction itself uses.
      const configOrgId =
        caller.mode === 'org' ? caller.orgId : brandsMap.get(id)!.orgId;
      confirmedByBrandId.set(id, await getConfirmedByBrandId(configOrgId, id));
    }),
  );

  const provenance: Record<string, FieldProvenance> = {};
  for (const key of fieldKeys) {
    if (!isUserFacingFieldKey(key)) {
      provenance[key] = 'extracted';
      continue;
    }

    let allConfirmed = true;
    for (const meta of brandsMeta) {
      const entry = confirmedByBrandId.get(meta.brandId)?.get(key);
      if (entry) {
        const perBrand = responseFields[key].byBrand[meta.domain];
        if (perBrand) perBrand.value = entry.value;
      } else {
        allConfirmed = false;
      }
    }

    provenance[key] = allConfirmed ? 'confirmed' : 'suggested';

    if (allConfirmed && brandIds.length === 1) {
      const entry = confirmedByBrandId.get(brandsMeta[0].brandId)?.get(key);
      if (entry) responseFields[key].value = entry.value;
    }
  }

  return { brands: brandsMeta, fields: responseFields, provenance };
}
