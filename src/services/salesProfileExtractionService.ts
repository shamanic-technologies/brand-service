import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { db, brands, brandSalesProfiles } from '../db';

const SCRAPING_SERVICE_URL = process.env.SCRAPING_SERVICE_URL || 'http://localhost:3010';
const SCRAPING_SERVICE_API_KEY = process.env.SCRAPING_SERVICE_API_KEY || '';

// Cache duration: 30 days
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SalesProfile {
  id: string;
  brandId: string;
  companyName: string | null;
  valueProposition: string | null;
  customerPainPoints: string[];
  callToAction: string | null;
  socialProof: {
    caseStudies: string[];
    testimonials: string[];
    results: string[];
  };
  companyOverview: string | null;
  additionalContext: string | null;
  competitors: string[];
  productDifferentiators: string[];
  targetAudience: string | null;
  keyFeatures: string[];
  extractionModel: string | null;
  extractionCostUsd: number | null;
  extractedAt: string;
  expiresAt: string | null;
}

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
  clerkOrgId: string | null;
}

function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

async function mapSiteUrls(url: string): Promise<string[]> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/map`,
      { url, limit: 100 },
      {
        headers: { 'X-API-Key': SCRAPING_SERVICE_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    if (!response.data.success) throw new Error(response.data.error || 'Map failed');
    return response.data.urls || [];
  } catch (error: any) {
    console.error('Map site URLs error:', error.message);
    throw new Error(`Failed to map site: ${error.message}`);
  }
}

async function scrapeUrl(url: string, brandId: string): Promise<string | null> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/scrape`,
      { url, sourceService: 'brand-service', sourceOrgId: brandId },
      {
        headers: { 'X-API-Key': SCRAPING_SERVICE_API_KEY, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    return response.data.result?.rawMarkdown || null;
  } catch (error: any) {
    console.error(`Scrape error for ${url}:`, error.message);
    return null;
  }
}

async function selectRelevantUrls(allUrls: string[], anthropicClient: Anthropic): Promise<string[]> {
  if (allUrls.length <= 10) return allUrls;

  const prompt = `You are helping extract sales/marketing information from a company website.

Given this list of URLs from the website, select the TOP 10 most relevant pages for extracting:
- Company overview and value proposition
- Customer pain points and target audience
- Products/services and key features
- Case studies, testimonials, and social proof
- Pricing and call-to-action
- Competitors and differentiators

URLs to choose from:
${allUrls.slice(0, 100).map((u, i) => `${i + 1}. ${u}`).join('\n')}

Return ONLY a JSON array of the 10 most relevant URLs (in order of importance):
["url1", "url2", ...]

Prioritize: homepage, about, pricing, features, customers, case-studies, testimonials, product, solutions, why-us pages.
Skip: blog posts, news, careers, legal, privacy, terms pages.`;

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).slice(0, 10);
  } catch (error: any) {
    console.error('URL selection error:', error.message);
  }
  return allUrls.slice(0, 10);
}

async function extractSalesProfileFromContent(
  pageContents: { url: string; content: string }[],
  anthropicClient: Anthropic
): Promise<{
  profile: Omit<SalesProfile, 'id' | 'brandId' | 'extractedAt' | 'expiresAt'>;
  inputTokens: number;
  outputTokens: number;
}> {
  const combinedContent = pageContents
    .filter(p => p.content)
    .map(p => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 15000)}`)
    .join('\n\n');

  const prompt = `You are analyzing a company website to extract sales and marketing information.

Analyze the following website content and extract structured information:

${combinedContent.substring(0, 100000)}

---

Extract the following information and return as JSON:

{
  "companyName": "Official company or product name",
  "valueProposition": "Core value proposition / elevator pitch (1-2 sentences)",
  "customerPainPoints": ["Pain point 1", "Pain point 2", ...],
  "callToAction": "Primary CTA on the site (e.g., 'Book a demo', 'Start free trial')",
  "socialProof": {
    "caseStudies": ["Case study 1 summary", ...],
    "testimonials": ["Testimonial quote 1", ...],
    "results": ["Result/metric 1 (e.g., '50% increase in sales')", ...]
  },
  "companyOverview": "Brief company description (2-3 sentences)",
  "additionalContext": "Any other relevant context for sales outreach",
  "competitors": ["Competitor 1", "Competitor 2", ...],
  "productDifferentiators": ["Differentiator 1", "Differentiator 2", ...],
  "targetAudience": "Who the product is for (e.g., 'Sales teams at B2B SaaS companies')",
  "keyFeatures": ["Feature 1", "Feature 2", ...]
}

Be specific and extract actual content from the pages. If information is not found, use empty arrays or null.
Return ONLY valid JSON.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse AI response as JSON');

  const parsed = JSON.parse(match[0]);
  const cost = (response.usage.input_tokens * 5 + response.usage.output_tokens * 25) / 1000000;

  return {
    profile: {
      companyName: parsed.companyName || null,
      valueProposition: parsed.valueProposition || null,
      customerPainPoints: parsed.customerPainPoints || [],
      callToAction: parsed.callToAction || null,
      socialProof: parsed.socialProof || { caseStudies: [], testimonials: [], results: [] },
      companyOverview: parsed.companyOverview || null,
      additionalContext: parsed.additionalContext || null,
      competitors: parsed.competitors || [],
      productDifferentiators: parsed.productDifferentiators || [],
      targetAudience: parsed.targetAudience || null,
      keyFeatures: parsed.keyFeatures || [],
      extractionModel: 'claude-opus-4-5',
      extractionCostUsd: cost,
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function formatProfileFromDb(row: typeof brandSalesProfiles.$inferSelect): SalesProfile {
  return {
    id: row.id,
    brandId: row.brandId,
    companyName: row.companyName,
    valueProposition: row.valueProposition,
    customerPainPoints: (row.customerPainPoints as string[]) || [],
    callToAction: row.callToAction,
    socialProof: (row.socialProof as any) || { caseStudies: [], testimonials: [], results: [] },
    companyOverview: row.companyOverview,
    additionalContext: row.additionalContext,
    competitors: (row.competitors as string[]) || [],
    productDifferentiators: (row.productDifferentiators as string[]) || [],
    targetAudience: row.targetAudience,
    keyFeatures: (row.keyFeatures as string[]) || [],
    extractionModel: row.extractionModel,
    extractionCostUsd: row.extractionCostUsd ? parseFloat(row.extractionCostUsd) : null,
    extractedAt: row.extractedAt,
    expiresAt: row.expiresAt,
  };
}

export async function getExistingSalesProfile(brandId: string): Promise<SalesProfile | null> {
  const result = await db
    .select()
    .from(brandSalesProfiles)
    .where(
      and(
        eq(brandSalesProfiles.brandId, brandId),
        gt(brandSalesProfiles.expiresAt, sql`NOW()`)
      )
    )
    .limit(1);

  return result.length > 0 ? formatProfileFromDb(result[0]) : null;
}

export async function getBrand(brandId: string): Promise<Brand | null> {
  const result = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      clerkOrgId: brands.clerkOrgId,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  return result[0] || null;
}

function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

export async function getOrCreateBrand(clerkOrgId: string, url: string): Promise<Brand> {
  const domain = extractDomainFromUrl(url);

  // CASE 1: Find existing brand by clerkOrgId + domain
  const existingByBoth = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      clerkOrgId: brands.clerkOrgId,
    })
    .from(brands)
    .where(and(eq(brands.clerkOrgId, clerkOrgId), eq(brands.domain, domain)))
    .limit(1);

  if (existingByBoth.length > 0) {
    const brand = existingByBoth[0];
    if (brand.url !== url) {
      await db.update(brands).set({ url, updatedAt: sql`NOW()` }).where(eq(brands.id, brand.id));
      brand.url = url;
    }
    console.log(`[sales-profile] Found existing brand by clerkOrgId+domain: ${brand.id}`);
    return brand;
  }

  // CASE 2: Check if brand exists by domain alone (UNIQUE constraint on domain!)
  // This handles the case where domain was created by another clerkOrgId or without clerkOrgId
  const existingByDomain = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      clerkOrgId: brands.clerkOrgId,
    })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);

  if (existingByDomain.length > 0) {
    const brand = existingByDomain[0];
    // Domain exists - update it with this clerkOrgId if not set, or if same org
    if (!brand.clerkOrgId || brand.clerkOrgId === clerkOrgId) {
      await db.update(brands).set({ 
        clerkOrgId, 
        url, 
        updatedAt: sql`NOW()` 
      }).where(eq(brands.id, brand.id));
      brand.clerkOrgId = clerkOrgId;
      brand.url = url;
      console.log(`[sales-profile] Updated existing brand (domain match) with clerkOrgId: ${brand.id}`);
      return brand;
    }
    // Domain already owned by different org - log warning but still return the brand
    // This is a conflict scenario - the domain is already taken
    console.warn(`[sales-profile] Domain ${domain} already owned by org ${brand.clerkOrgId}, requested by ${clerkOrgId}`);
    // Return existing brand - caller can decide what to do
    return brand;
  }

  // CASE 3: Check if brand exists by clerkOrgId alone (different domain)
  const existingByClerkOrgId = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      clerkOrgId: brands.clerkOrgId,
    })
    .from(brands)
    .where(eq(brands.clerkOrgId, clerkOrgId))
    .limit(1);

  if (existingByClerkOrgId.length > 0) {
    // Org already has a brand with different domain - update with new domain
    const brand = existingByClerkOrgId[0];
    await db.update(brands).set({ 
      url, 
      domain,
      updatedAt: sql`NOW()` 
    }).where(eq(brands.id, brand.id));
    brand.url = url;
    brand.domain = domain;
    console.log(`[sales-profile] Updated existing brand (clerkOrgId match) with new domain: ${brand.id}`);
    return brand;
  }

  // CASE 4: Create new brand - no existing match
  const inserted = await db
    .insert(brands)
    .values({ clerkOrgId, url, domain })
    .returning({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      clerkOrgId: brands.clerkOrgId,
    });

  console.log(`[sales-profile] Created NEW brand for ${clerkOrgId} with domain ${domain}: ${inserted[0].id}`);
  return inserted[0];
}

export async function getSalesProfileByClerkOrgId(clerkOrgId: string): Promise<SalesProfile | null> {
  const result = await db
    .select()
    .from(brandSalesProfiles)
    .innerJoin(brands, eq(brandSalesProfiles.brandId, brands.id))
    .where(and(eq(brands.clerkOrgId, clerkOrgId), gt(brandSalesProfiles.expiresAt, sql`NOW()`)))
    .orderBy(desc(brandSalesProfiles.extractedAt))
    .limit(1);

  return result.length > 0 ? formatProfileFromDb(result[0].brand_sales_profiles) : null;
}

export async function getAllSalesProfilesByClerkOrgId(
  clerkOrgId: string
): Promise<(SalesProfile & { url: string | null; domain: string | null })[]> {
  const result = await db
    .select()
    .from(brandSalesProfiles)
    .innerJoin(brands, eq(brandSalesProfiles.brandId, brands.id))
    .where(eq(brands.clerkOrgId, clerkOrgId))
    .orderBy(desc(brandSalesProfiles.extractedAt));

  return result.map(row => ({
    ...formatProfileFromDb(row.brand_sales_profiles),
    url: row.brands.url,
    domain: row.brands.domain,
  }));
}

async function upsertSalesProfile(
  brandId: string,
  profile: Omit<SalesProfile, 'id' | 'brandId' | 'extractedAt' | 'expiresAt'>,
  inputTokens: number,
  outputTokens: number,
  scrapeIds: string[]
): Promise<SalesProfile> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  const result = await db
    .insert(brandSalesProfiles)
    .values({
      brandId,
      companyName: profile.companyName,
      valueProposition: profile.valueProposition,
      customerPainPoints: profile.customerPainPoints,
      callToAction: profile.callToAction,
      socialProof: profile.socialProof,
      companyOverview: profile.companyOverview,
      additionalContext: profile.additionalContext,
      competitors: profile.competitors,
      productDifferentiators: profile.productDifferentiators,
      targetAudience: profile.targetAudience,
      keyFeatures: profile.keyFeatures,
      extractionModel: profile.extractionModel,
      extractionInputTokens: inputTokens,
      extractionOutputTokens: outputTokens,
      extractionCostUsd: profile.extractionCostUsd?.toString(),
      sourceScrapeIds: scrapeIds,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: brandSalesProfiles.brandId,
      set: {
        companyName: profile.companyName,
        valueProposition: profile.valueProposition,
        customerPainPoints: profile.customerPainPoints,
        callToAction: profile.callToAction,
        socialProof: profile.socialProof,
        companyOverview: profile.companyOverview,
        additionalContext: profile.additionalContext,
        competitors: profile.competitors,
        productDifferentiators: profile.productDifferentiators,
        targetAudience: profile.targetAudience,
        keyFeatures: profile.keyFeatures,
        extractionModel: profile.extractionModel,
        extractionInputTokens: inputTokens,
        extractionOutputTokens: outputTokens,
        extractionCostUsd: profile.extractionCostUsd?.toString(),
        sourceScrapeIds: scrapeIds,
        extractedAt: sql`NOW()`,
        expiresAt,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  return formatProfileFromDb(result[0]);
}

export async function extractBrandSalesProfile(
  brandId: string,
  anthropicApiKey: string,
  options: { skipCache?: boolean; forceRescrape?: boolean } = {}
): Promise<{ cached: boolean; profile: SalesProfile }> {
  if (!options.skipCache) {
    const existing = await getExistingSalesProfile(brandId);
    if (existing) return { cached: true, profile: existing };
  }

  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.url) throw new Error('Brand has no URL');

  const anthropicClient = getAnthropicClient(anthropicApiKey);

  console.log(`[${brandId}] Mapping site URLs for: ${brand.url}`);
  const allUrls = await mapSiteUrls(brand.url);
  console.log(`[${brandId}] Found ${allUrls.length} URLs`);

  console.log(`[${brandId}] Selecting relevant URLs...`);
  const selectedUrls = await selectRelevantUrls(allUrls, anthropicClient);
  console.log(`[${brandId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);

  console.log(`[${brandId}] Scraping ${selectedUrls.length} pages...`);
  const scrapePromises = selectedUrls.map(url =>
    scrapeUrl(url, brandId).then(content => ({ url, content: content || '' }))
  );
  const pageContents = await Promise.all(scrapePromises);
  const successfulScrapes = pageContents.filter(p => p.content);
  console.log(`[${brandId}] Successfully scraped ${successfulScrapes.length} pages`);

  if (successfulScrapes.length === 0) throw new Error('Failed to scrape any pages');

  console.log(`[${brandId}] Extracting sales profile with AI...`);
  const { profile, inputTokens, outputTokens } = await extractSalesProfileFromContent(
    successfulScrapes,
    anthropicClient
  );

  const savedProfile = await upsertSalesProfile(brandId, profile, inputTokens, outputTokens, []);
  console.log(`[${brandId}] Sales profile extracted and saved`);

  return { cached: false, profile: savedProfile };
}
