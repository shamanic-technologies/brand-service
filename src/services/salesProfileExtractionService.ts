import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import pool from '../db';

const SCRAPING_SERVICE_URL = process.env.SCRAPING_SERVICE_URL || 'http://localhost:3010';
const SCRAPING_SERVICE_API_KEY = process.env.SCRAPING_SERVICE_API_KEY || '';

// Cache duration: 30 days
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SalesProfile {
  id: string;
  organizationId: string;
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

interface Organization {
  id: string;
  url: string;
  name: string | null;
}

/**
 * Get Anthropic client with BYOK
 */
function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/**
 * Call scraping service to map URLs
 */
async function mapSiteUrls(url: string): Promise<string[]> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/map`,
      { url, limit: 100 },
      {
        headers: {
          'X-API-Key': SCRAPING_SERVICE_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Map failed');
    }

    return response.data.urls || [];
  } catch (error: any) {
    console.error('Map site URLs error:', error.message);
    throw new Error(`Failed to map site: ${error.message}`);
  }
}

/**
 * Call scraping service to scrape a URL
 */
async function scrapeUrl(url: string, sourceOrgId: string): Promise<string | null> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/scrape`,
      { url, sourceService: 'company-service', sourceOrgId },
      {
        headers: {
          'X-API-Key': SCRAPING_SERVICE_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    return response.data.result?.rawMarkdown || null;
  } catch (error: any) {
    console.error(`Scrape error for ${url}:`, error.message);
    return null;
  }
}

/**
 * Use AI to select top 10 relevant URLs for sales profile extraction
 */
async function selectRelevantUrls(
  allUrls: string[],
  anthropicClient: Anthropic
): Promise<string[]> {
  if (allUrls.length <= 10) {
    return allUrls;
  }

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
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const urls = JSON.parse(match[0]);
      return urls.slice(0, 10);
    }
  } catch (error: any) {
    console.error('URL selection error:', error.message);
  }

  // Fallback: return first 10 URLs
  return allUrls.slice(0, 10);
}

/**
 * Extract sales profile from page contents using AI
 */
async function extractSalesProfile(
  pageContents: { url: string; content: string }[],
  anthropicClient: Anthropic
): Promise<{
  profile: Omit<SalesProfile, 'id' | 'organizationId' | 'extractedAt' | 'expiresAt'>;
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
    model: 'claude-3-haiku-20240307',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  
  if (!match) {
    throw new Error('Failed to parse AI response as JSON');
  }

  const parsed = JSON.parse(match[0]);

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
      extractionModel: 'claude-3-haiku-20240307',
      extractionCostUsd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Calculate cost for Claude 3 Haiku
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  // Haiku pricing: $0.25/1M input, $1.25/1M output
  return (inputTokens * 0.25 + outputTokens * 1.25) / 1000000;
}

/**
 * Get existing sales profile from database
 */
export async function getExistingSalesProfile(
  organizationId: string
): Promise<SalesProfile | null> {
  const query = `
    SELECT * FROM organization_sales_profiles
    WHERE organization_id = $1
    AND (expires_at IS NULL OR expires_at > NOW())
  `;

  const result = await pool.query(query, [organizationId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return formatProfileFromDb(row);
}

/**
 * Get organization by ID
 */
export async function getOrganization(organizationId: string): Promise<Organization | null> {
  const query = `SELECT id, url, name FROM organizations WHERE id = $1`;
  const result = await pool.query(query, [organizationId]);
  return result.rows[0] || null;
}

/**
 * Get or create organization by clerkOrgId
 */
export async function getOrCreateOrganizationByClerkId(
  clerkOrgId: string,
  url: string
): Promise<Organization> {
  // Try to find existing
  const findQuery = `SELECT id, url, name FROM organizations WHERE clerk_organization_id = $1`;
  const existing = await pool.query(findQuery, [clerkOrgId]);
  
  if (existing.rows.length > 0) {
    const org = existing.rows[0];
    // Update URL if not set
    if (!org.url && url) {
      await pool.query(
        `UPDATE organizations SET url = $1, updated_at = NOW() WHERE id = $2`,
        [url, org.id]
      );
      org.url = url;
    }
    return org;
  }
  
  // Create new organization
  const insertQuery = `
    INSERT INTO organizations (clerk_organization_id, url, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING id, url, name
  `;
  const result = await pool.query(insertQuery, [clerkOrgId, url]);
  console.log(`[sales-profile] Created organization for ${clerkOrgId} with URL ${url}`);
  return result.rows[0];
}

/**
 * Get sales profile by clerkOrgId
 */
export async function getSalesProfileByClerkOrgId(
  clerkOrgId: string
): Promise<SalesProfile | null> {
  const query = `
    SELECT sp.* 
    FROM organization_sales_profiles sp
    JOIN organizations o ON sp.organization_id = o.id
    WHERE o.clerk_organization_id = $1
    AND (sp.expires_at IS NULL OR sp.expires_at > NOW())
  `;
  
  const result = await pool.query(query, [clerkOrgId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return formatProfileFromDb(result.rows[0]);
}

/**
 * Save or update sales profile
 */
async function upsertSalesProfile(
  organizationId: string,
  profile: Omit<SalesProfile, 'id' | 'organizationId' | 'extractedAt' | 'expiresAt'>,
  inputTokens: number,
  outputTokens: number,
  scrapeIds: string[]
): Promise<SalesProfile> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS);

  const query = `
    INSERT INTO organization_sales_profiles (
      organization_id, company_name, value_proposition, customer_pain_points,
      call_to_action, social_proof, company_overview, additional_context,
      competitors, product_differentiators, target_audience, key_features,
      extraction_model, extraction_input_tokens, extraction_output_tokens,
      extraction_cost_usd, source_scrape_ids, extracted_at, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18)
    ON CONFLICT (organization_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      value_proposition = EXCLUDED.value_proposition,
      customer_pain_points = EXCLUDED.customer_pain_points,
      call_to_action = EXCLUDED.call_to_action,
      social_proof = EXCLUDED.social_proof,
      company_overview = EXCLUDED.company_overview,
      additional_context = EXCLUDED.additional_context,
      competitors = EXCLUDED.competitors,
      product_differentiators = EXCLUDED.product_differentiators,
      target_audience = EXCLUDED.target_audience,
      key_features = EXCLUDED.key_features,
      extraction_model = EXCLUDED.extraction_model,
      extraction_input_tokens = EXCLUDED.extraction_input_tokens,
      extraction_output_tokens = EXCLUDED.extraction_output_tokens,
      extraction_cost_usd = EXCLUDED.extraction_cost_usd,
      source_scrape_ids = EXCLUDED.source_scrape_ids,
      extracted_at = NOW(),
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING *
  `;

  const result = await pool.query(query, [
    organizationId,
    profile.companyName,
    profile.valueProposition,
    JSON.stringify(profile.customerPainPoints),
    profile.callToAction,
    JSON.stringify(profile.socialProof),
    profile.companyOverview,
    profile.additionalContext,
    JSON.stringify(profile.competitors),
    JSON.stringify(profile.productDifferentiators),
    profile.targetAudience,
    JSON.stringify(profile.keyFeatures),
    profile.extractionModel,
    inputTokens,
    outputTokens,
    profile.extractionCostUsd,
    JSON.stringify(scrapeIds),
    expiresAt,
  ]);

  return formatProfileFromDb(result.rows[0]);
}

/**
 * Format database row to SalesProfile
 */
function formatProfileFromDb(row: any): SalesProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    companyName: row.company_name,
    valueProposition: row.value_proposition,
    customerPainPoints: row.customer_pain_points || [],
    callToAction: row.call_to_action,
    socialProof: row.social_proof || { caseStudies: [], testimonials: [], results: [] },
    companyOverview: row.company_overview,
    additionalContext: row.additional_context,
    competitors: row.competitors || [],
    productDifferentiators: row.product_differentiators || [],
    targetAudience: row.target_audience,
    keyFeatures: row.key_features || [],
    extractionModel: row.extraction_model,
    extractionCostUsd: parseFloat(row.extraction_cost_usd) || null,
    extractedAt: row.extracted_at?.toISOString(),
    expiresAt: row.expires_at?.toISOString(),
  };
}

/**
 * Main extraction function
 */
export async function extractOrganizationSalesProfile(
  organizationId: string,
  anthropicApiKey: string,
  options: { skipCache?: boolean; forceRescrape?: boolean } = {}
): Promise<{ cached: boolean; profile: SalesProfile }> {
  // Check cache first
  if (!options.skipCache) {
    const existing = await getExistingSalesProfile(organizationId);
    if (existing) {
      return { cached: true, profile: existing };
    }
  }

  // Get organization
  const org = await getOrganization(organizationId);
  if (!org) {
    throw new Error('Organization not found');
  }

  if (!org.url) {
    throw new Error('Organization has no URL');
  }

  const anthropicClient = getAnthropicClient(anthropicApiKey);

  // Step 1: Map site URLs
  console.log(`[${organizationId}] Mapping site URLs for: ${org.url}`);
  const allUrls = await mapSiteUrls(org.url);
  console.log(`[${organizationId}] Found ${allUrls.length} URLs`);

  // Step 2: Select top 10 relevant URLs
  console.log(`[${organizationId}] Selecting relevant URLs...`);
  const selectedUrls = await selectRelevantUrls(allUrls, anthropicClient);
  console.log(`[${organizationId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);

  // Step 3: Scrape selected URLs in parallel
  console.log(`[${organizationId}] Scraping ${selectedUrls.length} pages...`);
  const scrapePromises = selectedUrls.map(url => 
    scrapeUrl(url, organizationId).then(content => ({ url, content: content || '' }))
  );
  const pageContents = await Promise.all(scrapePromises);
  const successfulScrapes = pageContents.filter(p => p.content);
  console.log(`[${organizationId}] Successfully scraped ${successfulScrapes.length} pages`);

  if (successfulScrapes.length === 0) {
    throw new Error('Failed to scrape any pages');
  }

  // Step 4: Extract sales profile with AI
  console.log(`[${organizationId}] Extracting sales profile with AI...`);
  const { profile, inputTokens, outputTokens } = await extractSalesProfile(
    successfulScrapes,
    anthropicClient
  );

  // Step 5: Save to database
  const savedProfile = await upsertSalesProfile(
    organizationId,
    profile,
    inputTokens,
    outputTokens,
    [] // scrape IDs not tracked for now
  );

  console.log(`[${organizationId}] Sales profile extracted and saved`);

  return { cached: false, profile: savedProfile };
}
