/**
 * Multi-brand field extraction service.
 *
 * Handles extracting fields from one or more brands. When multiple brands
 * are provided, produces both per-brand results and a consolidated view
 * across all brands.
 */

import { extractFields, getBrand, FieldSpec, ExtractedFieldResult } from './fieldExtractionService';
import { chatComplete, TrackingHeaders } from '../lib/chat-client';

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
}

export interface MultiBrandExtractFieldsOptions {
  brandIds: string[];
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

export interface BrandMeta {
  brandId: string;
  domain: string;
  name: string;
}

/** Unified response: always brands + { value, byBrand } per field */
export interface MultiBrandFieldsResponse {
  brands: BrandMeta[];
  fields: Record<string, {
    value: unknown;
    byBrand: Record<string, unknown>;
  }>;
}

/**
 * Consolidate per-brand field values into a merged view using an LLM.
 */
async function consolidateFields(
  fieldKeys: string[],
  byBrand: Record<string, Record<string, unknown>>,
  tracking: TrackingHeaders,
): Promise<Record<string, unknown>> {
  const perBrandSummary = Object.entries(byBrand)
    .map(([domain, fields]) => `Brand "${domain}":\n${JSON.stringify(fields, null, 2)}`)
    .join('\n\n');

  const result = await chatComplete(
    {
      systemPrompt:
        'You are a brand consolidation assistant. Given field values extracted from multiple brands, ' +
        'produce a single consolidated view that merges insights across all brands. ' +
        'Return ONLY valid JSON with the requested field keys.',
      message:
        `Consolidate the following field values across multiple brands into a single merged view.\n\n` +
        `Fields to consolidate: ${fieldKeys.join(', ')}\n\n` +
        `Per-brand values:\n${perBrandSummary}\n\n` +
        `Return a JSON object with exactly these keys: ${fieldKeys.map((k) => `"${k}"`).join(', ')}. ` +
        `For each field, produce a consolidated value that combines insights from all brands. ` +
        `For string fields, write a merged summary. For array fields, merge and deduplicate. ` +
        `For object fields, merge sensibly.`,
      responseFormat: 'json',
      temperature: 0,
      maxTokens: 4096,
    },
    tracking,
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
  const { brandIds, fields, orgId, userId, parentRunId, campaignId, featureSlug, brandIdHeader, workflowSlug, scrapeCacheTtlDays } = options;

  // Look up all brands first to validate and get domains
  const brandLookups = await Promise.all(brandIds.map((id) => getBrand(id)));
  const brandsMap = new Map<string, Brand>();

  for (let i = 0; i < brandIds.length; i++) {
    const brand = brandLookups[i];
    if (!brand) {
      throw new Error(`Brand not found: ${brandIds[i]}`);
    }
    if (!brand.url) {
      throw new Error(`Brand has no URL: ${brandIds[i]}`);
    }
    brandsMap.set(brandIds[i], brand);
  }

  // Build brands metadata array
  const brandsMeta: BrandMeta[] = brandIds.map((id) => {
    const brand = brandsMap.get(id)!;
    return {
      brandId: id,
      domain: brand.domain || new URL(brand.url!).hostname,
      name: brand.name || brand.domain || new URL(brand.url!).hostname,
    };
  });

  // Extract fields for each brand in parallel
  const perBrandResults = await Promise.all(
    brandIds.map((brandId) =>
      extractFields({
        brandId,
        fields,
        orgId,
        userId,
        parentRunId,
        campaignId,
        featureSlug,
        brandIdHeader,
        workflowSlug,
        scrapeCacheTtlDays,
      }),
    ),
  );

  // Build byBrand map (keyed by domain)
  const fieldKeys = fields.map((f) => f.key);
  const byDomain: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < brandIds.length; i++) {
    const domain = brandsMeta[i].domain;
    const brandResults = perBrandResults[i];

    const brandFields: Record<string, unknown> = {};
    for (const result of brandResults) {
      brandFields[result.key] = result.value;
    }
    byDomain[domain] = brandFields;
  }

  // Determine `value` per field: direct value for single brand, LLM-consolidated for multiple
  let valueMap: Record<string, unknown>;

  if (brandIds.length === 1) {
    const domain = brandsMeta[0].domain;
    valueMap = { ...byDomain[domain] };
  } else {
    const tracking: TrackingHeaders = {
      orgId,
      userId,
      runId: parentRunId,
      campaignId,
      featureSlug,
      brandId: brandIdHeader,
      workflowSlug,
    };
    console.log(`[brand-service] Consolidating fields across ${brandIds.length} brands`);
    valueMap = await consolidateFields(fieldKeys, byDomain, tracking);
  }

  // Build unified response
  const responseFields: Record<string, { value: unknown; byBrand: Record<string, unknown> }> = {};
  for (const key of fieldKeys) {
    const perBrand: Record<string, unknown> = {};
    for (const [domain, brandFields] of Object.entries(byDomain)) {
      perBrand[domain] = brandFields[key] ?? null;
    }
    responseFields[key] = {
      value: valueMap[key] ?? null,
      byBrand: perBrand,
    };
  }

  return { brands: brandsMeta, fields: responseFields };
}
