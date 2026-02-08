import Anthropic from '@anthropic-ai/sdk';
import { eq, and, gt, sql } from 'drizzle-orm';
import { db, brands, brandIcpSuggestionsForApollo } from '../db';
import {
  mapSiteUrls,
  scrapeUrl,
  selectRelevantUrls,
  getAnthropicClient,
  getOrCreateBrand,
  getBrand,
} from './salesProfileExtractionService';
import { createRun, updateRun, addCosts } from '../lib/runs-client';

// Cache duration: 30 days
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface IcpSuggestionForApollo {
  id: string;
  brandId: string;
  targetTitles: string[];
  targetIndustries: string[];
  targetLocations: string[];
  extractionModel: string | null;
  extractionCostUsd: number | null;
  extractedAt: string;
  expiresAt: string | null;
}

// Re-export for route convenience
export { getOrCreateBrand };

async function extractIcpFromContentForApollo(
  pageContents: { url: string; content: string }[],
  anthropicClient: Anthropic
): Promise<{
  icp: { targetTitles: string[]; targetIndustries: string[]; targetLocations: string[] };
  inputTokens: number;
  outputTokens: number;
}> {
  const combinedContent = pageContents
    .filter(p => p.content)
    .map(p => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 15000)}`)
    .join('\n\n');

  const prompt = `You are analyzing a company website to build an Ideal Customer Profile (ICP) for B2B cold outbound sales prospecting.

The goal is to identify WHO this company should target with cold emails — specifically the job titles, industries, and locations of their ideal buyers. The output will be used directly as search filters in Apollo.io's people search API.

Analyze the following website content:

${combinedContent.substring(0, 100000)}

---

Return a JSON object with exactly these three fields:

{
  "person_titles": ["Title 1", "Title 2", ...],
  "q_organization_keyword_tags": ["Keyword 1", "Keyword 2", ...],
  "organization_locations": ["Location 1", "Location 2", ...]
}

IMPORTANT — Follow these formatting rules precisely, as the values are passed directly to Apollo.io search filters:

**person_titles** (required, 3-8 values):
Job titles of the DECISION-MAKERS who would purchase this product/service. Think about who signs the contract or has budget authority.
- Use standard professional titles (e.g. "VP of Sales", "Head of Marketing", "CTO", "Director of Engineering", "Chief Revenue Officer")
- Do NOT use generic titles like "Manager" alone — be specific (e.g. "Engineering Manager", "Product Manager")
- Include a mix of seniority levels (VP, Director, Head of, Manager) for the relevant department

**q_organization_keyword_tags** (required, 2-6 values):
Keywords describing the types of companies/organizations to target. These are free-text tags used to match company descriptions in Apollo.
- Use industry keywords and business model descriptors (e.g. "SaaS", "B2B Software", "ecommerce", "fintech", "healthcare", "logistics")
- Be specific enough to be useful but broad enough to have volume
- Do NOT use overly generic tags like "technology" or "business"

**organization_locations** (required, 1-4 values):
Geographic regions where target companies are based. Use full country or region names.
- Examples: "United States", "United Kingdom", "Canada", "Germany", "Europe", "Australia"
- If the website doesn't clearly indicate geography, default to ["United States"]
- Do NOT use city-level locations unless the company is clearly local/regional

Return ONLY valid JSON, no other text.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse ICP extraction response as JSON');

  const parsed = JSON.parse(match[0]);

  return {
    icp: {
      targetTitles: parsed.person_titles || [],
      targetIndustries: parsed.q_organization_keyword_tags || [],
      targetLocations: parsed.organization_locations || ['United States'],
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function formatIcpFromDbForApollo(row: typeof brandIcpSuggestionsForApollo.$inferSelect): IcpSuggestionForApollo {
  return {
    id: row.id,
    brandId: row.brandId,
    targetTitles: (row.targetTitles as string[]) || [],
    targetIndustries: (row.targetIndustries as string[]) || [],
    targetLocations: (row.targetLocations as string[]) || [],
    extractionModel: row.extractionModel,
    extractionCostUsd: row.extractionCostUsd ? parseFloat(row.extractionCostUsd) : null,
    extractedAt: row.extractedAt,
    expiresAt: row.expiresAt,
  };
}

export async function getExistingIcpSuggestionForApollo(brandId: string): Promise<IcpSuggestionForApollo | null> {
  const result = await db
    .select()
    .from(brandIcpSuggestionsForApollo)
    .where(
      and(
        eq(brandIcpSuggestionsForApollo.brandId, brandId),
        gt(brandIcpSuggestionsForApollo.expiresAt, sql`NOW()`)
      )
    )
    .limit(1);

  return result.length > 0 ? formatIcpFromDbForApollo(result[0]) : null;
}

async function upsertIcpSuggestionForApollo(
  brandId: string,
  icp: { targetTitles: string[]; targetIndustries: string[]; targetLocations: string[] },
  inputTokens: number,
  outputTokens: number
): Promise<IcpSuggestionForApollo> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();
  const cost = (inputTokens * 5 + outputTokens * 25) / 1000000;

  const result = await db
    .insert(brandIcpSuggestionsForApollo)
    .values({
      brandId,
      targetTitles: icp.targetTitles,
      targetIndustries: icp.targetIndustries,
      targetLocations: icp.targetLocations,
      extractionModel: 'claude-opus-4-5',
      extractionInputTokens: inputTokens,
      extractionOutputTokens: outputTokens,
      extractionCostUsd: cost.toString(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: brandIcpSuggestionsForApollo.brandId,
      set: {
        targetTitles: icp.targetTitles,
        targetIndustries: icp.targetIndustries,
        targetLocations: icp.targetLocations,
        extractionModel: 'claude-opus-4-5',
        extractionInputTokens: inputTokens,
        extractionOutputTokens: outputTokens,
        extractionCostUsd: cost.toString(),
        extractedAt: sql`NOW()`,
        expiresAt,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  return formatIcpFromDbForApollo(result[0]);
}

export async function extractIcpSuggestionForApollo(
  brandId: string,
  anthropicApiKey: string,
  options: { skipCache?: boolean; clerkOrgId?: string; parentRunId?: string } = {}
): Promise<{ cached: boolean; icp: IcpSuggestionForApollo; runId?: string }> {
  if (!options.skipCache) {
    const existing = await getExistingIcpSuggestionForApollo(brandId);
    if (existing) return { cached: true, icp: existing };
  }

  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.url) throw new Error('Brand has no URL');

  // Resolve clerkOrgId for run tracking
  const clerkOrgId = options.clerkOrgId || brand.clerkOrgId;

  // Create run in runs-service (best-effort)
  let runId: string | undefined;
  if (clerkOrgId) {
    try {
      const run = await createRun({
        clerkOrgId,
        appId: "mcpfactory",
        brandId,
        serviceName: "brand-service",
        taskName: "icp-extraction",
        parentRunId: options.parentRunId,
      });
      runId = run.id;
    } catch (err) {
      console.warn("[icp] Failed to create run in runs-service:", err);
    }
  }

  try {
    const anthropicClient = getAnthropicClient(anthropicApiKey);

    console.log(`[icp][${brandId}] Mapping site URLs for: ${brand.url}`);
    const allUrls = await mapSiteUrls(brand.url);

    console.log(`[icp][${brandId}] Selecting relevant URLs...`);
    const selectedUrls = await selectRelevantUrls(allUrls, anthropicClient);

    console.log(`[icp][${brandId}] Scraping ${selectedUrls.length} pages...`);
    const scrapePromises = selectedUrls.map(url =>
      scrapeUrl(url, brandId).then(content => ({ url, content: content || '' }))
    );
    const pageContents = await Promise.all(scrapePromises);
    const successfulScrapes = pageContents.filter(p => p.content);

    if (successfulScrapes.length === 0) throw new Error('Failed to scrape any pages');

    console.log(`[icp][${brandId}] Extracting ICP with AI...`);
    const { icp, inputTokens, outputTokens } = await extractIcpFromContentForApollo(
      successfulScrapes,
      anthropicClient
    );

    const saved = await upsertIcpSuggestionForApollo(brandId, icp, inputTokens, outputTokens);
    console.log(`[icp][${brandId}] ICP suggestion extracted and saved`);

    // Record costs and complete run (best-effort)
    if (runId) {
      try {
        const costItems = [];
        if (inputTokens) costItems.push({ costName: "anthropic-opus-4.5-tokens-input", quantity: inputTokens });
        if (outputTokens) costItems.push({ costName: "anthropic-opus-4.5-tokens-output", quantity: outputTokens });
        if (costItems.length > 0) await addCosts(runId, costItems);
        await updateRun(runId, "completed");
      } catch (err) {
        console.warn("[icp] Failed to track run costs in runs-service:", err);
      }
    }

    return { cached: false, icp: saved, runId };
  } catch (error) {
    // Mark run as failed (best-effort)
    if (runId) {
      try { await updateRun(runId, "failed"); } catch (err) {
        console.warn("[icp] Failed to mark run as failed:", err);
      }
    }
    throw error;
  }
}
