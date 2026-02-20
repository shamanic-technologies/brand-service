import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { db, brands, brandSalesProfiles, orgs, users } from '../db';
import { createRun, updateRun, addCosts } from '../lib/runs-client';

const SCRAPING_SERVICE_URL = process.env.SCRAPING_SERVICE_URL || 'http://localhost:3010';
const SCRAPING_SERVICE_API_KEY = process.env.SCRAPING_SERVICE_API_KEY || '';

// Cache duration: 30 days
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface Testimonial {
  quote: string;
  name: string | null;
  role: string | null;
  company: string | null;
}

export interface LeadershipMember {
  name: string;
  role: string;
  bio: string | null;
  notableBackground: string | null;
}

export interface FundingInfo {
  totalRaised: string | null;
  rounds: Array<{
    type: string;
    amount: string | null;
    date: string | null;
    notableInvestors: string[];
  }>;
  notableBackers: string[];
}

export interface Award {
  title: string;
  issuer: string | null;
  year: string | null;
  description: string | null;
}

export interface RevenueMilestone {
  metric: string;
  value: string;
  date: string | null;
  context: string | null;
}

export interface Urgency {
  elements: string[];
  summary: string | null;
}

export interface Scarcity {
  elements: string[];
  summary: string | null;
}

export interface RiskReversal {
  guarantees: string[];
  trialInfo: string | null;
  refundPolicy: string | null;
}

export interface PriceAnchoring {
  anchors: string[];
  comparisonPoints: string[];
}

export interface ValueStacking {
  bundledValue: string[];
  totalPerceivedValue: string | null;
}

export interface SalesProfile {
  id: string;
  brandId: string;
  valueProposition: string | null;
  customerPainPoints: string[];
  callToAction: string | null;
  socialProof: {
    caseStudies: string[];
    testimonials: Array<string | Testimonial>;
    results: string[];
  };
  companyOverview: string | null;
  additionalContext: string | null;
  competitors: string[];
  productDifferentiators: string[];
  targetAudience: string | null;
  keyFeatures: string[];
  leadership: LeadershipMember[];
  funding: FundingInfo | null;
  awardsAndRecognition: Award[];
  revenueMilestones: RevenueMilestone[];
  urgency: Urgency | null;
  scarcity: Scarcity | null;
  riskReversal: RiskReversal | null;
  priceAnchoring: PriceAnchoring | null;
  valueStacking: ValueStacking | null;
  extractionModel: string | null;
  extractedAt: string;
  expiresAt: string | null;
}

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
}

export function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

interface ScrapingTrackingContext {
  brandId: string;
  sourceOrgId: string;
  parentRunId: string;
  clerkUserId?: string;
}

export async function mapSiteUrls(url: string, tracking?: ScrapingTrackingContext): Promise<string[]> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/map`,
      {
        url,
        limit: 100,
        ...(tracking && {
          brandId: tracking.brandId,
          sourceOrgId: tracking.sourceOrgId,
          parentRunId: tracking.parentRunId,
          clerkUserId: tracking.clerkUserId,
        }),
      },
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

export async function scrapeUrl(url: string, tracking?: ScrapingTrackingContext): Promise<string | null> {
  try {
    const response = await axios.post(
      `${SCRAPING_SERVICE_URL}/scrape`,
      {
        url,
        sourceService: 'brand-service',
        sourceOrgId: tracking?.sourceOrgId || '',
        ...(tracking && {
          brandId: tracking.brandId,
          parentRunId: tracking.parentRunId,
          clerkUserId: tracking.clerkUserId,
        }),
      },
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

export async function selectRelevantUrls(allUrls: string[], anthropicClient: Anthropic): Promise<string[]> {
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
      model: 'claude-sonnet-4-6',
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

export interface UserHints {
  urgency?: string;
  scarcity?: string;
  riskReversal?: string;
  socialProof?: string;
}

async function extractSalesProfileFromContent(
  pageContents: { url: string; content: string }[],
  anthropicClient: Anthropic,
  userHints?: UserHints
): Promise<{
  brandName: string | null;
  profile: Omit<SalesProfile, 'id' | 'brandId' | 'extractedAt' | 'expiresAt'>;
  inputTokens: number;
  outputTokens: number;
}> {
  const combinedContent = pageContents
    .filter(p => p.content)
    .map(p => `=== PAGE: ${p.url} ===\n${p.content.substring(0, 15000)}`)
    .join('\n\n');

  const userHintLines: string[] = [];
  if (userHints?.urgency) userHintLines.push(`- Urgency: ${userHints.urgency}`);
  if (userHints?.scarcity) userHintLines.push(`- Scarcity: ${userHints.scarcity}`);
  if (userHints?.riskReversal) userHintLines.push(`- Risk reversal: ${userHints.riskReversal}`);
  if (userHints?.socialProof) userHintLines.push(`- Social proof: ${userHints.socialProof}`);

  const userHintBlock = userHintLines.length > 0
    ? `\n\n---\n\nIMPORTANT — The user has provided the following information about their brand. This takes priority over anything found on the website. Incorporate these into the relevant fields:\n${userHintLines.join('\n')}\n`
    : '';

  const prompt = `You are analyzing a company website to extract sales, marketing, and persuasion information.

Analyze the following website content and extract structured information:

${combinedContent.substring(0, 100000)}
${userHintBlock}
---

Extract the following information and return as JSON:

{
  "brandName": "Official company or product name",
  "valueProposition": "Core value proposition / elevator pitch (1-2 sentences)",
  "customerPainPoints": ["Pain point 1", "Pain point 2", ...],
  "callToAction": "Primary CTA on the site (e.g., 'Book a demo', 'Start free trial')",
  "socialProof": {
    "caseStudies": ["Case study 1 summary", ...],
    "testimonials": [
      { "quote": "Testimonial quote", "name": "Jane Doe", "role": "CTO", "company": "Acme Corp" }
    ],
    "results": ["Result/metric 1 (e.g., '50% increase in sales')", ...],
    "clientLogos": ["Notable client or partner name mentioned on the site", ...],
    "totalCustomers": "Number of customers/users if mentioned (e.g., '10,000+ companies')",
    "notableBackersOrPartners": ["Well-known backers, investors, or strategic partners featured on the site", ...]
  },
  "companyOverview": "Brief company description (2-3 sentences)",
  "additionalContext": "Any other relevant context for sales outreach",
  "competitors": ["Competitor 1", "Competitor 2", ...],
  "productDifferentiators": ["Differentiator 1", "Differentiator 2", ...],
  "targetAudience": "Who the product is for (e.g., 'Sales teams at B2B SaaS companies')",
  "keyFeatures": ["Feature 1", "Feature 2", ...],
  "leadership": [
    { "name": "Jane Smith", "role": "CEO & Co-founder", "bio": "Brief bio (1-2 sentences)", "notableBackground": "Former VP at Google" }
  ],
  "funding": {
    "totalRaised": "$25M",
    "rounds": [
      { "type": "Series A", "amount": "$10M", "date": "2023", "notableInvestors": ["Sequoia"] }
    ],
    "notableBackers": ["Y Combinator"]
  },
  "awardsAndRecognition": [
    { "title": "Best SaaS 2023", "issuer": "G2", "year": "2023", "description": null }
  ],
  "revenueMilestones": [
    { "metric": "ARR", "value": "$5M", "date": "2023", "context": "Announced publicly" }
  ],
  "urgency": {
    "elements": ["Any time-limited offers, deadlines, countdowns, or expiring promotions (e.g., 'Price goes up Friday', 'Registration closes March 15', 'Early-bird pricing ends soon')"],
    "summary": "One-sentence summary of urgency signals found on the site, or null if none"
  },
  "scarcity": {
    "elements": ["Any quantity limits, limited availability, exclusive access, or capacity constraints (e.g., 'Only 10 spots left', 'Limited to 50 participants', 'Accepting 3 clients per quarter')"],
    "summary": "One-sentence summary of scarcity signals found on the site, or null if none"
  },
  "riskReversal": {
    "guarantees": ["Any guarantees, promises, or risk-reducing commitments (e.g., 'Money-back guarantee', '100% satisfaction guaranteed', 'If you don't get X result, we refund you')"],
    "trialInfo": "Free trial or test period details if available (e.g., '14-day free trial', 'Try for 30 days risk-free')",
    "refundPolicy": "Refund or money-back policy if mentioned (e.g., '30-day full refund', 'Cancel anytime')"
  },
  "priceAnchoring": {
    "anchors": ["Any reference prices, 'normally costs X', total value mentions, or price comparisons (e.g., 'Total value: $25,000', 'Agencies charge $15K for this')"],
    "comparisonPoints": ["Explicit value vs. price comparisons (e.g., 'Get $25K of value for $997', '10x cheaper than hiring in-house')"]
  },
  "valueStacking": {
    "bundledValue": ["Individual components, bonuses, or extras included in the offer (e.g., 'Includes 1-on-1 coaching ($5K value)', 'Bonus: private community access', 'Press coverage + podcast placement + event speaking')"],
    "totalPerceivedValue": "Total stacked value if mentioned (e.g., '$25,000+ in total value')"
  }
}

EXTRACTION GUIDELINES:
- For testimonials, extract structured objects with quote, name, role, and company when available. Use null for unknown attribution fields.
- For socialProof: be aggressive in extracting proof signals — look for client logos, "trusted by X companies", partner logos, investor names displayed on the site, press mentions, and volume metrics.
- For leadership, funding, awards, and revenue milestones: only include what is explicitly published on the site. Use empty arrays or null if not found.
- For urgency and scarcity: look for countdown timers, limited-time banners, "spots remaining", cohort deadlines, seasonal offers. These are time-based (urgency) vs. quantity-based (scarcity) constraints.
- For riskReversal: look for guarantees, free trials, "cancel anytime", money-back promises, "no commitment" language, and any language that shifts risk from buyer to seller.
- For priceAnchoring: look for crossed-out prices, "normally $X", value comparisons, ROI calculators, "competitors charge $X" language.
- For valueStacking: look for offer breakdowns, bonus lists, "what's included" sections, value itemization. This is about how the brand bundles and presents total perceived value.
- Be specific and extract actual content from the pages. If information is not found, use empty arrays or null.
Return ONLY valid JSON.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse AI response as JSON');

  const parsed = JSON.parse(match[0]);

  const brandName: string | null = parsed.brandName || null;

  return {
    brandName,
    profile: {
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
      leadership: parsed.leadership || [],
      funding: parsed.funding || null,
      awardsAndRecognition: parsed.awardsAndRecognition || [],
      revenueMilestones: parsed.revenueMilestones || [],
      urgency: parsed.urgency || null,
      scarcity: parsed.scarcity || null,
      riskReversal: parsed.riskReversal || null,
      priceAnchoring: parsed.priceAnchoring || null,
      valueStacking: parsed.valueStacking || null,
      extractionModel: 'claude-sonnet-4-6',
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function formatProfileFromDb(row: typeof brandSalesProfiles.$inferSelect): SalesProfile {
  const rawSocialProof = (row.socialProof as any) || {};
  return {
    id: row.id,
    brandId: row.brandId,
    valueProposition: row.valueProposition,
    customerPainPoints: (row.customerPainPoints as string[]) || [],
    callToAction: row.callToAction,
    socialProof: {
      caseStudies: rawSocialProof.caseStudies || [],
      testimonials: rawSocialProof.testimonials || [],
      results: rawSocialProof.results || [],
    },
    companyOverview: row.companyOverview,
    additionalContext: row.additionalContext,
    competitors: (row.competitors as string[]) || [],
    productDifferentiators: (row.productDifferentiators as string[]) || [],
    targetAudience: row.targetAudience,
    keyFeatures: (row.keyFeatures as string[]) || [],
    leadership: (row.leadership as LeadershipMember[]) || [],
    funding: (row.funding as FundingInfo) || null,
    awardsAndRecognition: (row.awardsAndRecognition as Award[]) || [],
    revenueMilestones: (row.revenueMilestones as RevenueMilestone[]) || [],
    urgency: (row.urgency as Urgency) || null,
    scarcity: (row.scarcity as Scarcity) || null,
    riskReversal: (row.riskReversal as RiskReversal) || null,
    priceAnchoring: (row.priceAnchoring as PriceAnchoring) || null,
    valueStacking: (row.valueStacking as ValueStacking) || null,
    extractionModel: row.extractionModel,
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

export async function resolveOrCreateOrg(appId: string, clerkOrgId: string): Promise<{ id: string }> {
  const existing = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(eq(orgs.appId, appId), eq(orgs.clerkOrgId, clerkOrgId)))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(orgs)
    .values({ appId, clerkOrgId })
    .onConflictDoNothing()
    .returning({ id: orgs.id });

  // Handle race condition: if conflict, re-fetch
  if (!created) {
    const [refetched] = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(and(eq(orgs.appId, appId), eq(orgs.clerkOrgId, clerkOrgId)))
      .limit(1);
    return refetched;
  }

  return created;
}

export async function resolveOrCreateUser(clerkUserId: string, orgId: string): Promise<{ id: string }> {
  const existing = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (existing.length > 0) {
    // Update orgId if not set
    if (!existing[0].orgId) {
      await db.update(users)
        .set({ orgId, updatedAt: sql`NOW()` })
        .where(eq(users.id, existing[0].id));
    }
    return { id: existing[0].id };
  }

  const [created] = await db
    .insert(users)
    .values({ clerkUserId, orgId })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (!created) {
    const [refetched] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);
    return refetched;
  }

  return created;
}

export async function getOrCreateBrand(
  clerkOrgId: string,
  url: string,
  options?: { appId?: string; clerkUserId?: string }
): Promise<Brand> {
  const appId = options?.appId ?? 'mcpfactory';

  // Resolve or create org
  const org = await resolveOrCreateOrg(appId, clerkOrgId);

  // Optionally resolve or create user
  if (options?.clerkUserId) {
    await resolveOrCreateUser(options.clerkUserId, org.id);
  }

  const domain = extractDomainFromUrl(url);

  // CASE 1: Find existing brand by orgId + domain
  const existingByBoth = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands)
    .where(and(eq(brands.orgId, org.id), eq(brands.domain, domain)))
    .limit(1);

  if (existingByBoth.length > 0) {
    const brand = existingByBoth[0];
    if (brand.url !== url) {
      await db.update(brands).set({ url, updatedAt: sql`NOW()` }).where(eq(brands.id, brand.id));
      brand.url = url;
    }
    console.log(`[brand] Found existing brand by orgId+domain: ${brand.id}`);
    return brand;
  }

  // CASE 2: Check if brand exists by domain alone (UNIQUE constraint on domain!)
  const existingByDomain = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
      orgId: brands.orgId,
    })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);

  if (existingByDomain.length > 0) {
    const brand = existingByDomain[0];
    if (brand.orgId === org.id) {
      await db.update(brands).set({
        url,
        updatedAt: sql`NOW()`
      }).where(eq(brands.id, brand.id));
      brand.url = url;
      console.log(`[brand] Updated existing brand (domain match): ${brand.id}`);
      return brand;
    }
    console.warn(`[brand] Domain ${domain} already owned by org ${brand.orgId}, requested by ${org.id}`);
    return { id: brand.id, url: brand.url, name: brand.name, domain: brand.domain };
  }

  // CASE 3: Create new brand
  const inserted = await db
    .insert(brands)
    .values({ url, domain, orgId: org.id })
    .returning({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    });

  console.log(`[brand] Created NEW brand for org ${org.id} with domain ${domain}: ${inserted[0].id}`);
  return inserted[0];
}

export async function getSalesProfileByClerkOrgId(clerkOrgId: string): Promise<SalesProfile | null> {
  const result = await db
    .select()
    .from(brandSalesProfiles)
    .innerJoin(brands, eq(brandSalesProfiles.brandId, brands.id))
    .innerJoin(orgs, eq(brands.orgId, orgs.id))
    .where(and(eq(orgs.clerkOrgId, clerkOrgId), gt(brandSalesProfiles.expiresAt, sql`NOW()`)))
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
    .innerJoin(orgs, eq(brands.orgId, orgs.id))
    .where(eq(orgs.clerkOrgId, clerkOrgId))
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
  scrapeIds: string[]
): Promise<SalesProfile> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  const result = await db
    .insert(brandSalesProfiles)
    .values({
      brandId,
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
      leadership: profile.leadership,
      funding: profile.funding,
      awardsAndRecognition: profile.awardsAndRecognition,
      revenueMilestones: profile.revenueMilestones,
      urgency: profile.urgency,
      scarcity: profile.scarcity,
      riskReversal: profile.riskReversal,
      priceAnchoring: profile.priceAnchoring,
      valueStacking: profile.valueStacking,
      extractionModel: profile.extractionModel,
      sourceScrapeIds: scrapeIds,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: brandSalesProfiles.brandId,
      set: {
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
        leadership: profile.leadership,
        funding: profile.funding,
        awardsAndRecognition: profile.awardsAndRecognition,
        revenueMilestones: profile.revenueMilestones,
        urgency: profile.urgency,
        scarcity: profile.scarcity,
        riskReversal: profile.riskReversal,
        priceAnchoring: profile.priceAnchoring,
        valueStacking: profile.valueStacking,
        extractionModel: profile.extractionModel,
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
  options: { skipCache?: boolean; forceRescrape?: boolean; clerkOrgId: string; clerkUserId?: string; parentRunId: string; workflowName?: string; userHints?: UserHints }
): Promise<{ cached: boolean; profile: SalesProfile; runId?: string }> {
  if (!options.skipCache) {
    const existing = await getExistingSalesProfile(brandId);
    if (existing) return { cached: true, profile: existing };
  }

  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.url) throw new Error('Brand has no URL');

  // Resolve clerkOrgId for run tracking — required for cost tracking
  const clerkOrgId = options.clerkOrgId;
  if (!clerkOrgId) {
    throw new Error('[sales-profile] clerkOrgId is required for run/cost tracking');
  }

  // Create run in runs-service
  const run = await createRun({
    clerkOrgId,
    clerkUserId: options.clerkUserId,
    appId: "mcpfactory",
    brandId,
    serviceName: "brand-service",
    taskName: "sales-profile-extraction",
    parentRunId: options.parentRunId,
    workflowName: options.workflowName,
  });
  const runId = run.id;

  // Tracking context for child service calls (scraping-service)
  const scrapingTracking: ScrapingTrackingContext = {
    brandId,
    sourceOrgId: clerkOrgId,
    parentRunId: runId,
    clerkUserId: options.clerkUserId,
  };

  try {
    const anthropicClient = getAnthropicClient(anthropicApiKey);

    console.log(`[${brandId}] Mapping site URLs for: ${brand.url}`);
    const allUrls = await mapSiteUrls(brand.url, scrapingTracking);
    console.log(`[${brandId}] Found ${allUrls.length} URLs`);

    console.log(`[${brandId}] Selecting relevant URLs...`);
    const selectedUrls = await selectRelevantUrls(allUrls, anthropicClient);
    console.log(`[${brandId}] Selected ${selectedUrls.length} URLs:`, selectedUrls);

    console.log(`[${brandId}] Scraping ${selectedUrls.length} pages...`);
    const scrapePromises = selectedUrls.map(url =>
      scrapeUrl(url, scrapingTracking).then(content => ({ url, content: content || '' }))
    );
    const pageContents = await Promise.all(scrapePromises);
    const successfulScrapes = pageContents.filter(p => p.content);
    console.log(`[${brandId}] Successfully scraped ${successfulScrapes.length} pages`);

    if (successfulScrapes.length === 0) throw new Error('Failed to scrape any pages');

    console.log(`[${brandId}] Extracting sales profile with AI...`);
    const { brandName, profile, inputTokens, outputTokens } = await extractSalesProfileFromContent(
      successfulScrapes,
      anthropicClient,
      options.userHints
    );

    const savedProfile = await upsertSalesProfile(brandId, profile, []);

    // Backfill brands.name from AI-extracted brandName if not already set
    if (brandName) {
      await db.update(brands)
        .set({ name: brandName, updatedAt: sql`NOW()` })
        .where(and(eq(brands.id, brandId), sql`${brands.name} IS NULL`));
    }

    console.log(`[${brandId}] Sales profile extracted and saved`);

    // Record costs and complete run — must succeed
    const costItems = [];
    if (inputTokens) costItems.push({ costName: "anthropic-sonnet-4.6-tokens-input", quantity: inputTokens });
    if (outputTokens) costItems.push({ costName: "anthropic-sonnet-4.6-tokens-output", quantity: outputTokens });
    if (costItems.length > 0) await addCosts(runId, costItems);
    await updateRun(runId, "completed");

    return { cached: false, profile: savedProfile, runId };
  } catch (error) {
    // Mark run as failed (best-effort — original error takes priority)
    try { await updateRun(runId, "failed"); } catch (err) {
      console.warn("[sales-profile] Failed to mark run as failed:", err);
    }
    throw error;
  }
}
