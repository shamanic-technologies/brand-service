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
 *   3. Each site read is JUDGED to be that company's own site (Jev, ONE
 *      chat-service judgment for the whole discovery,
 *      COMPETITOR-SITE-IS-THE-COMPANY-1024): a domain that loads but belongs
 *      to someone else is NOT that company's (velo.xyz is not Velo Data). The
 *      model gives up to 3 candidate domains per competitor; the first one
 *      judged the company wins, else the competitor is served WITHOUT a
 *      website (`competitorsWithoutWebsite`), never with a guessed one.
 *   4. The LinkedIn company page is the one the CONFIRMED homepage LINKS to.
 *      Nothing is guessed from a name: no link = `linkedinUrl: null`.
 *
 * The brand's own domain and duplicates are dropped. Rows stored before the
 * judgment existed are judged by `verifyUncheckedCompetitorWebsites` (boot +
 * daily, platform-billed); until then they are served without a website.
 *
 * Stored once and reused: reads never compute. A discovery row with no
 * competitor rows is "computed, nothing found", distinct from "never computed"
 * (no discovery row). Re-running replaces the whole set.
 */

import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { PAGE_CACHE_TTL_DAYS } from '../lib/page-cache-ttl';
import {
  db,
  brands,
  brandExtractedFields,
  brandUserFields,
  brandCompetitorDiscoveries,
  brandCompetitors,
} from '../db';
import { chat, judgeNouls, type OrgCaller, type PlatformCaller } from '../lib/chat-client';
import { brandSetupSupport } from '../lib/platform-support';
import {
  MAX_CANDIDATE_DOMAINS,
  buildWebsiteJudgment,
  candidateKey,
  pickConfirmedDomain,
  type JudgedCandidate,
} from '../lib/competitor-website-judgment';
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
const SCRAPE_CACHE_TTL_DAYS = PAGE_CACHE_TTL_DAYS;
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
  /** Registrable domain of the competitor's website (`acme.com`), judged to be THAT company's own site. */
  domain: string;
  /** Jev's probability that `domain` is the company's own site (>= 0.5). */
  websiteConfidence: number;
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
  /** Competitors with a website judged to be theirs. */
  competitors: CompetitorView[];
  /** Competitors named, whose own website could not be confirmed: served by name only, never with a guessed site. */
  competitorsWithoutWebsite: { name: string }[];
}

/** One competitor as resolved by a discovery, before storage. */
interface ResolvedCompetitor {
  name: string;
  /** The model's first guess, kept as provenance (never served). */
  proposedDomain: string;
  domain: string | null;
  websiteConfidence: number | null;
  linkedinUrl: string | null;
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
    return { brandId, status: 'not_computed', discoveredAt: null, provenance: null, competitors: [], competitorsWithoutWebsite: [] };
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
    // A site is served only once judged that company's (`website_checked_at`
    // set by the judgment). A row stored before the judgment, not judged yet,
    // is served by name only: an unconfirmed site is never a link.
    competitors: rows
      .filter((r) => r.domain !== null && r.websiteCheckedAt !== null && r.websiteConfidence !== null)
      .map((r) => ({
        name: r.name,
        domain: r.domain as string,
        websiteConfidence: r.websiteConfidence as number,
        linkedinUrl: r.linkedinUrl,
        linkedinSource: r.linkedinUrl ? LINKEDIN_SOURCE_COMPETITOR_WEBSITE : null,
      })),
    competitorsWithoutWebsite: rows
      .filter((r) => !(r.domain !== null && r.websiteCheckedAt !== null && r.websiteConfidence !== null))
      .map((r) => ({ name: r.name })),
  };
}

// ─── Discover ───────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = [
  'You are a B2B market analyst. Given a company profile, name its DIRECT competitors:',
  'companies a buyer of this company would seriously consider INSTEAD of it, because they',
  'sell the same kind of product or service to the same kind of customer, in the same market.',
  '',
  'Rules:',
  `- Return at most ${MAX_COMPETITORS} competitors, most direct first. Fewer is fine; none is fine.`,
  '- Only name companies you are confident exist, with their real official website domain',
  '  (e.g. "hubspot.com"). Never invent a company or a domain.',
  `- "otherDomains": up to ${MAX_CANDIDATE_DOMAINS - 1} OTHER domains the company may really use, when you are`,
  '  not sure "domain" is right (a .io / .app / .ai variant, a product-name domain). Empty when sure.',
  '- Not the company itself, not its parent or subsidiaries, not marketplaces, directories,',
  '  review sites, generic platforms (Google, Amazon, LinkedIn) or tools it merely uses.',
  '- Prefer competitors of a similar size and market to this company over global giants,',
  '  unless the giants are the real alternatives its buyers compare it with.',
  '- Names and text in English.',
  '',
  'Return ONLY JSON: { "competitors": [ { "name": string, "domain": string, "otherDomains": string[] } ] }',
].join('\n');

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          otherDomains: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'domain', 'otherDomains'],
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
 * extraction already filled, else one scrape). Empty string = nothing.
 */
async function brandContext(
  brandId: string,
  orgId: string,
  brand: { domain: string | null; url: string | null },
  reader: WebsiteReader,
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
    // Free plain read first; a homepage that refuses it (bot wall, JS shell) is
    // read once through the cached scrape, so a brand whose profile was never
    // extracted is never stuck at "not computed".
    const html = await reader.fetchHomepage(domain);
    const plain = html ? htmlToText(html) : '';
    const page = plain.length > 0 ? plain : await reader.scrapeHomepage(domain);
    if (page && page.trim().length > 0) {
      blocks.push('Its homepage (text):\n' + page.trim().slice(0, HOMEPAGE_TEXT_MAX_CHARS));
    }
  }

  return blocks.join('\n\n');
}

export interface ProposedCompetitor {
  name: string;
  /** The model's first guess. */
  domain: string;
  /** Domains to try, in order: `domain` first, then the model's alternatives (deduped, capped). */
  candidates: string[];
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
    const candidates = [domain];
    const others = Array.isArray((item as any).otherDomains) ? (item as any).otherDomains : [];
    for (const other of others) {
      const d = normalizeCompetitorDomain(other);
      if (!d || d === own || candidates.includes(d)) continue;
      if (candidates.length >= MAX_CANDIDATE_DOMAINS) break;
      candidates.push(d);
    }
    out.push({ name: name.slice(0, 120), domain, candidates });
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

/** A candidate site, read: the raw page (HTML or scraped markdown) and its visible text. */
interface CandidatePage {
  domain: string;
  /** HTML (plain read) or markdown (scrape), for the LinkedIn link. */
  raw: string;
  /** Whether `raw` came from the plain read (a scrape may still find a client-side link). */
  plain: boolean;
  text: string;
}

/**
 * Read one candidate domain's homepage: plain HTTP (free), else, only when
 * `allowScrape`, one cached scrape. Null = could not be read (never judged,
 * never confirmed).
 */
async function readCandidatePage(domain: string, reader: WebsiteReader, allowScrape: boolean): Promise<CandidatePage | null> {
  const html = await reader.fetchHomepage(domain);
  if (html !== null) {
    const text = htmlToText(html);
    if (text.length > 0) return { domain, raw: html, plain: true, text };
  }
  if (!allowScrape) return null;
  const scraped = await reader.scrapeHomepage(domain);
  if (!scraped || scraped.trim().length === 0) return null;
  return { domain, raw: scraped, plain: false, text: scraped.replace(/\s+/g, ' ').trim() };
}

/** Asks Jev the questions built by `buildWebsiteJudgment`. Test seam. */
export type WebsiteJudge = (
  judgment: ReturnType<typeof buildWebsiteJudgment>,
) => Promise<Record<string, number>>;

export function jevWebsiteJudge(caller: OrgCaller | PlatformCaller): WebsiteJudge {
  return (judgment) => judgeNouls(judgment.state, judgment.questions, caller);
}

/**
 * Resolve every proposed competitor to a site JUDGED to be its own, or none.
 * Every candidate is read in parallel (the first guess may fall back to one
 * scrape; alternatives are plain reads only), then ONE Jev call judges all the
 * pages. The first candidate judged the company wins; a site confirmed for two
 * names goes to the first. The LinkedIn link is read off the confirmed site
 * only (one scrape when the plain read shows none, as before). Exported for tests.
 */
export async function resolveCompetitorSites(
  proposed: ProposedCompetitor[],
  seller: { name: string | null; website: string | null },
  reader: WebsiteReader,
  judge: WebsiteJudge,
): Promise<ResolvedCompetitor[]> {
  const pages = await Promise.all(
    proposed.map((c) => Promise.all(c.candidates.map((d, j) => readCandidatePage(d, reader, j === 0)))),
  );

  const judged: JudgedCandidate[] = [];
  proposed.forEach((c, i) => {
    pages[i].forEach((page, j) => {
      if (page) judged.push({ key: candidateKey(i, j), companyName: c.name, domain: page.domain, pageText: page.text });
    });
  });
  const probabilities = judged.length > 0 ? await judge(buildWebsiteJudgment(seller, judged)) : {};

  const taken = new Set<string>();
  return Promise.all(
    proposed.map(async (c, i) => {
      const verdict = pickConfirmedDomain(
        c.candidates.map((d, j) => ({ key: candidateKey(i, j), domain: d })),
        probabilities,
      );
      if (verdict.domain === null || taken.has(verdict.domain)) {
        return { name: c.name, proposedDomain: c.domain, domain: null, websiteConfidence: verdict.confidence, linkedinUrl: null };
      }
      taken.add(verdict.domain);
      const page = pages[i][c.candidates.indexOf(verdict.domain)] as CandidatePage;
      const identity = { name: c.name, domain: verdict.domain };
      let linkedinUrl = extractLinkedinCompanyUrl(page.raw, identity);
      // A plain read with no link may be a JS shell: one rendered scrape, which
      // also catches links injected client-side.
      if (!linkedinUrl && page.plain) {
        const scraped = await reader.scrapeHomepage(verdict.domain);
        if (scraped) linkedinUrl = extractLinkedinCompanyUrl(scraped, identity);
      }
      return {
        name: c.name,
        proposedDomain: c.domain,
        domain: verdict.domain,
        websiteConfidence: verdict.confidence,
        linkedinUrl,
      };
    }),
  );
}

export interface DiscoverOptions {
  brandId: string;
  caller: OrgCaller;
  /** Recompute even when a stored answer exists. Default: reuse it. */
  refresh?: boolean;
  /** Test seam for the website reads. */
  reader?: WebsiteReader;
  /** Test seam for the "is this site that company" judgment. Default: Jev, org-billed on the discovery run. */
  judge?: WebsiteJudge;
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
    const reader = opts.reader ?? defaultReader(brandId, runCaller);
    const context = await brandContext(brandId, caller.orgId, brand, reader);
    if (context.length === 0) {
      throw new CompetitorDiscoveryUnavailableError(
        `Cannot discover competitors for brand ${brandId}: nothing is known about it (no offer, no profile, no readable homepage)`,
      );
    }

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

    const resolved = await resolveCompetitorSites(
      proposed,
      { name: brand.name, website: brand.domain ?? brand.url },
      reader,
      opts.judge ?? jevWebsiteJudge(runCaller),
    );
    const checkedAt = new Date().toISOString();

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
      if (resolved.length > 0) {
        await tx.insert(brandCompetitors).values(
          resolved.map((c, position) => ({
            brandId,
            position,
            name: c.name,
            domain: c.domain,
            proposedDomain: c.proposedDomain,
            websiteConfidence: c.websiteConfidence,
            websiteCheckedAt: checkedAt,
            linkedinUrl: c.linkedinUrl,
            linkedinSource: c.linkedinUrl ? LINKEDIN_SOURCE_COMPETITOR_WEBSITE : null,
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

// ─── Judge rows stored before the judgment existed ──────────────────────────

const UNCHECKED_SWEEP_SUPPORT_REASON =
  'Judging whether competitor websites stored before the check are really those companies (sweep, no user request)';

/**
 * Judge every stored competitor site never judged (rows from before
 * COMPETITOR-SITE-IS-THE-COMPANY-1024): one platform-billed Jev call per brand,
 * on a free plain read or an already-saved page (never a new scrape: no org
 * pays here). Confirmed = kept; not confirmed or unreadable = the site and its
 * LinkedIn page (read off that site) are cleared, the name stays. Idempotent:
 * every row it touches gets `website_checked_at`. Returns rows judged.
 */
export async function verifyUncheckedCompetitorWebsites(
  opts: { reader?: WebsiteReader; judge?: WebsiteJudge } = {},
): Promise<number> {
  const rows = await db
    .select({
      id: brandCompetitors.id,
      brandId: brandCompetitors.brandId,
      name: brandCompetitors.name,
      domain: brandCompetitors.domain,
    })
    .from(brandCompetitors)
    .where(and(isNull(brandCompetitors.websiteCheckedAt), isNotNull(brandCompetitors.domain)));
  if (rows.length === 0) return 0;

  const reader: WebsiteReader = opts.reader ?? {
    fetchHomepage,
    scrapeHomepage: (domain: string) => getCachedPageContent(`https://${domain}`),
  };
  const judge = opts.judge ?? jevWebsiteJudge({ mode: 'platform', support: brandSetupSupport(UNCHECKED_SWEEP_SUPPORT_REASON) });

  const byBrand = new Map<string, typeof rows>();
  for (const row of rows) byBrand.set(row.brandId, [...(byBrand.get(row.brandId) ?? []), row]);

  let judgedCount = 0;
  for (const [brandId, brandRows] of byBrand) {
    try {
      const [brand] = await db
        .select({ name: brands.name, domain: brands.domain, url: brands.url })
        .from(brands)
        .where(eq(brands.id, brandId))
        .limit(1);
      const proposed: ProposedCompetitor[] = brandRows.map((r) => ({
        name: r.name,
        domain: r.domain as string,
        candidates: [r.domain as string],
      }));
      const resolved = await resolveCompetitorSites(
        proposed,
        { name: brand?.name ?? null, website: brand?.domain ?? brand?.url ?? null },
        reader,
        judge,
      );
      const checkedAt = new Date().toISOString();
      await db.transaction(async (tx) => {
        for (const [i, row] of brandRows.entries()) {
          const r = resolved[i];
          const set = r.domain === null
            ? { domain: null, proposedDomain: row.domain, websiteConfidence: r.websiteConfidence, websiteCheckedAt: checkedAt, linkedinUrl: null, linkedinSource: null }
            : { proposedDomain: row.domain, websiteConfidence: r.websiteConfidence, websiteCheckedAt: checkedAt };
          await tx.update(brandCompetitors).set(set).where(eq(brandCompetitors.id, row.id));
        }
      });
      judgedCount += brandRows.length;
    } catch (error) {
      // One brand failing (Jev unreachable) leaves its rows unjudged for the next
      // pass; they stay served by name only meanwhile, never with an unconfirmed site.
      console.error(`[brand-service] Competitor website check failed for brand ${brandId}:`, error);
    }
  }
  console.log(`[brand-service] Competitor website check: ${judgedCount}/${rows.length} stored sites judged`);
  return judgedCount;
}
