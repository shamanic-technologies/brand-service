/**
 * A brand's DIRECT competitors, and each competitor's LinkedIn company page.
 *
 * We find them; the client never types them (owner, 2026-10-03: "c'est à nous de
 * gérer nos audiences"). First consumer: human-service, which builds the
 * "people who engaged with a competitor's LinkedIn posts" audience from the
 * pages read here.
 *
 * How, cheapest first (owner rule: no paid data provider per brand):
 *   1. ONE cheap model call through chat-service names the competitors and
 *      their websites, from what this service already knows about the brand
 *      (its extracted profile: overview, services, industry, audience...).
 *      chat-service is the terminal LLM caller and declares the token cost on a
 *      brand-service run (a fraction of a cent).
 *   2. Each competitor's homepage is fetched over plain HTTP (free). A homepage
 *      that will not answer plain HTTP (a bot wall, a JS shell) is read once
 *      through scraping-service, which declares its own cost, cached in
 *      `page_scrape_cache` like every other scrape here.
 *   3. The LinkedIn company page is the one that homepage LINKS to. Nothing is
 *      guessed from a name: no link = `linkedinUrl: null`.
 *
 * A competitor whose website cannot be read at all is DROPPED: a domain nobody
 * serves is most likely one the model made up, and storing it would be storing
 * an invention. The brand's own domain and duplicates are dropped too.
 *
 * Stored once and reused: reads never compute. A discovery row with no
 * competitor rows is "computed, nothing found", distinct from "never computed"
 * (no discovery row). Re-running replaces the whole set.
 */

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  db,
  brands,
  brandExtractedFields,
  brandUserFields,
  brandCompetitorDiscoveries,
  brandCompetitors,
} from '../db';
import { chat, type OrgCaller } from '../lib/chat-client';
import { createRun, updateRun } from '../lib/runs-client';
import { scrapeUrl } from '../lib/scraping-client';
import { extractLinkedinCompanyUrl, normalizeCompetitorDomain } from '../lib/competitor-linkedin';
import { getCachedPageContent, upsertPageContent } from './scrapeOrchestrator';
import { listOffers } from './brandOffersService';

/** At most this many competitors are asked for, and kept. */
export const MAX_COMPETITORS = 8;
/** Model tier that names the competitors (cheap Gemini Flash via chat-service). */
export const COMPETITOR_MODEL = 'flash-pro' as const;
/** The one place a LinkedIn URL may come from. */
export const LINKEDIN_SOURCE_COMPETITOR_WEBSITE = 'competitor_website' as const;

const HOMEPAGE_TIMEOUT_MS = 8000;
const HOMEPAGE_MAX_CHARS = 2_000_000;
const SCRAPE_CACHE_TTL_DAYS = 180;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';


export class BrandNotFoundError extends Error {
  constructor(brandId: string) {
    super(`Brand ${brandId} not found`);
    this.name = 'BrandNotFoundError';
  }
}

/** The brand carries nothing to describe it yet, so nobody can say who it competes with. */
export class CompetitorDiscoveryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompetitorDiscoveryUnavailableError';
  }
}

export interface CompetitorView {
  name: string;
  /** Registrable domain of the competitor's website (`acme.com`). */
  domain: string;
  /** `https://www.linkedin.com/company/<slug>/`, or null when its site links none. */
  linkedinUrl: string | null;
  /** Where `linkedinUrl` was read: `competitor_website`. Null when there is no URL. */
  linkedinSource: typeof LINKEDIN_SOURCE_COMPETITOR_WEBSITE | null;
}

export interface BrandCompetitorsView {
  brandId: string;
  /** `not_computed` = never looked for; `computed` = looked for (competitors may be empty). */
  status: 'not_computed' | 'computed';
  discoveredAt: string | null;
  provenance: {
    method: 'llm_named_then_website_read';
    model: string;
    proposedCount: number;
    runId: string | null;
  } | null;
  competitors: CompetitorView[];
}

// ─── Read ───────────────────────────────────────────────────────────────────

async function assertBrandExists(brandId: string): Promise<{ name: string | null; domain: string | null; url: string | null }> {
  const [brand] = await db
    .select({ name: brands.name, domain: brands.domain, url: brands.url })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new BrandNotFoundError(brandId);
  return brand;
}

/** The stored answer. Never computes. Throws `BrandNotFoundError` for an unknown brand. */
export async function readBrandCompetitors(brandId: string): Promise<BrandCompetitorsView> {
  await assertBrandExists(brandId);
  const [discovery] = await db
    .select()
    .from(brandCompetitorDiscoveries)
    .where(eq(brandCompetitorDiscoveries.brandId, brandId))
    .limit(1);
  if (!discovery) {
    return { brandId, status: 'not_computed', discoveredAt: null, provenance: null, competitors: [] };
  }
  const rows = await db
    .select()
    .from(brandCompetitors)
    .where(eq(brandCompetitors.brandId, brandId))
    .orderBy(asc(brandCompetitors.position));
  return {
    brandId,
    status: 'computed',
    discoveredAt: discovery.discoveredAt,
    provenance: {
      method: 'llm_named_then_website_read',
      model: discovery.model,
      proposedCount: discovery.proposedCount,
      runId: discovery.runId,
    },
    competitors: rows.map((r) => ({
      name: r.name,
      domain: r.domain,
      linkedinUrl: r.linkedinUrl,
      linkedinSource: r.linkedinUrl ? LINKEDIN_SOURCE_COMPETITOR_WEBSITE : null,
    })),
  };
}

// ─── Discover ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You are a B2B market analyst. Given a company profile, name its DIRECT competitors:',
  'companies a buyer of this company would seriously consider INSTEAD of it, because they',
  'sell the same kind of product or service to the same kind of customer, in the same market.',
  '',
  'Rules:',
  `- Return at most ${MAX_COMPETITORS} competitors, most direct first. Fewer is fine; none is fine.`,
  '- Only name companies you are confident exist, with their real official website domain',
  '  (e.g. "hubspot.com"). Never invent a company or a domain.',
  '- Not the company itself, not its parent or subsidiaries, not marketplaces, directories,',
  '  review sites, generic platforms (Google, Amazon, LinkedIn) or tools it merely uses.',
  '- Prefer competitors of a similar size and market to this company over global giants,',
  '  unless the giants are the real alternatives its buyers compare it with.',
  '- Names and text in English.',
  '',
  'Return ONLY JSON: { "competitors": [ { "name": string, "domain": string } ] }',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, domain: { type: 'string' } },
        required: ['name', 'domain'],
      },
    },
  },
  required: ['competitors'],
};

/**
 * Extracted-field keys worth showing the model. `brand_extracted_fields` is an
 * ephemeral (3-day) cache whose keys are open-ended — one brand carries 1,100
 * `social-view-*` rows — so it is read through an ALLOWLIST, never whole.
 */
const CONTEXT_FIELD_KEYS = [
  'companyOverview', 'services', 'valueProposition', 'industry', 'keyFeatures',
  'productDifferentiators', 'offerHowItWorks', 'dreamOutcome', 'geography',
  'targetAudience', 'customerPainPoints',
];
const CONTEXT_VALUE_MAX_CHARS = 600;
const HOMEPAGE_TEXT_MAX_CHARS = 6000;

/** Visible text of an HTML page (scripts, styles and tags dropped, whitespace collapsed). Pure. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function capValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = Array.isArray(value)
    ? value.filter((v) => v !== null && v !== undefined).map(String).join('; ')
    : typeof value === 'string' ? value : JSON.stringify(value);
  const trimmed = text.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
  return trimmed.slice(0, CONTEXT_VALUE_MAX_CHARS);
}

/**
 * What we know about the brand, as prompt text: the offers the asking org sells
 * under it, its confirmed fields, an allowlist of extracted fields, and the
 * visible text of its homepage (free plain read, else the page cache the
 * extraction already filled; never a new paid scrape). Empty string = nothing.
 */
async function brandContext(
  brandId: string,
  orgId: string,
  brand: { domain: string | null; url: string | null },
): Promise<string> {
  const blocks: string[] = [];

  const offers = (await listOffers(orgId, brandId)).filter((o) => o.status === 'active');
  if (offers.length > 0) {
    blocks.push('What it sells (offers):\n' + offers
      .map((o) => `- ${o.name}${o.description ? `: ${o.description.slice(0, CONTEXT_VALUE_MAX_CHARS)}` : ''}`)
      .join('\n'));
  }

  const fields = new Map<string, string>();
  const confirmed = await db
    .select({ fieldKey: brandUserFields.fieldKey, value: brandUserFields.value })
    .from(brandUserFields)
    .where(and(eq(brandUserFields.orgId, orgId), eq(brandUserFields.brandId, brandId), inArray(brandUserFields.fieldKey, CONTEXT_FIELD_KEYS)));
  for (const row of confirmed) {
    const v = capValue(row.value);
    if (v && !fields.has(row.fieldKey)) fields.set(row.fieldKey, v);
  }
  const extracted = await db
    .select({ fieldKey: brandExtractedFields.fieldKey, fieldValue: brandExtractedFields.fieldValue })
    .from(brandExtractedFields)
    .where(and(
      eq(brandExtractedFields.brandId, brandId),
      isNull(brandExtractedFields.campaignId),
      inArray(brandExtractedFields.fieldKey, CONTEXT_FIELD_KEYS),
    ));
  for (const row of extracted) {
    const v = capValue(row.fieldValue);
    if (v && !fields.has(row.fieldKey)) fields.set(row.fieldKey, v);
  }
  if (fields.size > 0) {
    blocks.push('Profile:\n' + [...fields].map(([k, v]) => `- ${k}: ${v}`).join('\n'));
  }

  const domain = normalizeCompetitorDomain(brand.domain ?? brand.url);
  if (domain) {
    const html = await fetchHomepage(domain);
    const page = html ? htmlToText(html) : await getCachedPageContent(`https://${domain}`);
    if (page && page.trim().length > 0) {
      blocks.push('Its homepage (text):\n' + page.trim().slice(0, HOMEPAGE_TEXT_MAX_CHARS));
    }
  }

  return blocks.join('\n\n');
}

export interface ProposedCompetitor {
  name: string;
  domain: string;
}

/**
 * The model's answer, cleaned: names trimmed, domains reduced to registrable
 * domains, the brand's own domain and duplicates dropped, capped. Pure.
 * Malformed output throws (fail loud, never an empty list standing in for one).
 */
export function parseProposedCompetitors(raw: unknown, brandDomain: string | null): ProposedCompetitor[] {
  const list = raw && typeof raw === 'object' ? (raw as { competitors?: unknown }).competitors : undefined;
  if (!Array.isArray(list)) {
    throw new Error('[brand-service] Competitor discovery failed: model output had no "competitors" array');
  }
  const own = brandDomain ? normalizeCompetitorDomain(brandDomain) : null;
  const seen = new Set<string>();
  const out: ProposedCompetitor[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof (item as any).name === 'string' ? (item as any).name.trim() : '';
    const domain = normalizeCompetitorDomain((item as any).domain);
    if (!name || !domain || domain === own || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name: name.slice(0, 120), domain });
    if (out.length >= MAX_COMPETITORS) break;
  }
  return out;
}

/** The homepage over plain HTTP, or null when it does not answer with a page. */
async function fetchHomepage(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${domain}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HOMEPAGE_TIMEOUT_MS),
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return null;
    const body = await res.text();
    return body.slice(0, HOMEPAGE_MAX_CHARS);
  } catch {
    return null;
  }
}

export interface WebsiteReader {
  /** Free plain-HTTP read of `https://<domain>`. */
  fetchHomepage(domain: string): Promise<string | null>;
  /** Paid fallback (scraping-service), cached. */
  scrapeHomepage(domain: string): Promise<string | null>;
}

function defaultReader(brandId: string, caller: OrgCaller): WebsiteReader {
  return {
    fetchHomepage,
    async scrapeHomepage(domain: string) {
      const url = `https://${domain}`;
      const cached = await getCachedPageContent(url);
      if (cached) return cached;
      const content = await scrapeUrl(url, {
        brandId,
        orgId: caller.orgId,
        userId: caller.userId || undefined,
        runId: caller.runId || undefined,
        campaignId: caller.campaignId,
        featureSlug: caller.featureSlug,
        brandIdHeader: caller.brandIdHeader,
        workflowSlug: caller.workflowSlug,
        audienceId: caller.audienceId,
      });
      if (content) await upsertPageContent(url, content, SCRAPE_CACHE_TTL_DAYS);
      return content;
    },
  };
}

/**
 * Read one competitor's website and the LinkedIn page it links. `null` = the
 * website could not be read at all (the competitor is dropped).
 */
export async function resolveCompetitorWebsite(
  competitor: ProposedCompetitor,
  reader: WebsiteReader,
): Promise<CompetitorView | null> {
  const html = await reader.fetchHomepage(competitor.domain);
  let linkedinUrl = html ? extractLinkedinCompanyUrl(html, competitor) : null;
  let readable = html !== null;
  // A plain read that failed, or found no link on what may be a JS shell: one
  // rendered scrape, which also catches links injected client-side.
  if (!linkedinUrl) {
    const scraped = await reader.scrapeHomepage(competitor.domain);
    if (scraped) {
      readable = true;
      linkedinUrl = extractLinkedinCompanyUrl(scraped, competitor);
    }
  }
  if (!readable) return null;
  return {
    name: competitor.name,
    domain: competitor.domain,
    linkedinUrl,
    linkedinSource: linkedinUrl ? LINKEDIN_SOURCE_COMPETITOR_WEBSITE : null,
  };
}

export interface DiscoverOptions {
  brandId: string;
  caller: OrgCaller;
  /** Recompute even when a stored answer exists. Default: reuse it. */
  refresh?: boolean;
  /** Test seam for the website reads. */
  reader?: WebsiteReader;
}

/**
 * Find (or reuse) the brand's competitors. Reuses the stored answer unless
 * `refresh`, so calling it again costs nothing.
 */
export async function discoverBrandCompetitors(opts: DiscoverOptions): Promise<BrandCompetitorsView> {
  const { brandId, caller } = opts;
  const brand = await assertBrandExists(brandId);

  if (!opts.refresh) {
    const stored = await readBrandCompetitors(brandId);
    if (stored.status === 'computed') return stored;
  }

  const context = await brandContext(brandId, caller.orgId, brand);
  if (context.length === 0) {
    throw new CompetitorDiscoveryUnavailableError(
      `Cannot discover competitors for brand ${brandId}: nothing is known about it (no offer, no profile, no readable homepage)`,
    );
  }

  const run = await createRun({
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    brandId,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
    serviceName: 'brand-service',
    taskName: 'competitor-discovery',
    parentRunId: caller.runId || undefined,
  });
  const runCaller: OrgCaller = { ...caller, runId: run.id };
  const identity = {
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    runId: run.id,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
  };

  try {
    const result = await chat(
      {
        systemPrompt: SYSTEM_PROMPT,
        message: [
          `Company: ${brand.name ?? '(unnamed)'}`,
          `Website: ${brand.domain ?? brand.url ?? '(none)'}`,
          '',
          context,
        ].join('\n'),
        provider: 'google',
        model: COMPETITOR_MODEL,
        responseFormat: 'json',
        responseSchema: RESPONSE_SCHEMA,
        maxTokens: 2048,
      },
      runCaller,
    );
    const raw = result.json ?? JSON.parse((result.content.match(/\{[\s\S]*\}/) ?? ['null'])[0]);
    const proposed = parseProposedCompetitors(raw, brand.domain ?? brand.url);

    const reader = opts.reader ?? defaultReader(brandId, runCaller);
    const resolved = await Promise.all(proposed.map((c) => resolveCompetitorWebsite(c, reader)));
    const kept = resolved.filter((c): c is CompetitorView => c !== null);

    await db.transaction(async (tx) => {
      await tx.delete(brandCompetitors).where(eq(brandCompetitors.brandId, brandId));
      const values = {
        brandId,
        discoveredAt: new Date().toISOString(),
        model: COMPETITOR_MODEL,
        requestedByOrgId: caller.orgId,
        runId: run.id,
        proposedCount: proposed.length,
      };
      await tx
        .insert(brandCompetitorDiscoveries)
        .values(values)
        .onConflictDoUpdate({ target: brandCompetitorDiscoveries.brandId, set: values });
      if (kept.length > 0) {
        await tx.insert(brandCompetitors).values(
          kept.map((c, position) => ({
            brandId,
            position,
            name: c.name,
            domain: c.domain,
            linkedinUrl: c.linkedinUrl,
            linkedinSource: c.linkedinSource,
          })),
        );
      }
    });

    await updateRun(run.id, 'completed', identity);
    return readBrandCompetitors(brandId);
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', identity);
    } catch (err) {
      console.warn(`[brand-service] Failed to mark competitor-discovery run ${run.id} as failed:`, err);
    }
    throw error;
  }
}
