/**
 * Brand CRUD utilities.
 *
 * Includes a lazy-fill helper (ensureBrandName) that derives brands.name on
 * first read (getBrandDetail) by fetching the landing page HTML and parsing
 * og:site_name / <title> / JSON-LD — NO LLM, Firecrawl, chat-service, run, or
 * cost. It falls back to a titlecased domain, so it always yields a non-empty
 * name. The brand-create path (getOrCreateBrand) no longer blocks on it.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, brands, orgBrands, brandClickDestinations } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';
import { Caller, OrgCaller } from '../lib/chat-client';
import { buildLogoDevUrl } from '../lib/logo-dev';

interface Brand {
  id: string;
  url: string;
  name: string | null;
  domain: string;
}

export interface BrandDetail {
  id: string;
  domain: string;
  url: string;
  name: string;
  logoUrl: string;
  // User-chosen page outreach clicks should land on. `null` = unset (the
  // dashboard then defaults to the brand's own domain). Per-brand config,
  // mirrors sales-economics scoping — never on the brand identity row.
  clickDestinationUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const inFlightBrandNameFills = new Map<string, Promise<string>>();

// Plain-fetch landing scrape used by the deterministic name fill. A normal
// browser User-Agent is sent because some sites 403 unknown agents; the meta
// tags we parse are absent from Firecrawl markdown, so we fetch raw HTML.
const BRAND_NAME_FETCH_TIMEOUT_MS = 5000;
const BRAND_NAME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export { extractDomain as extractDomainFromUrl };

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

export async function getBrandDetail(
  brandId: string,
  caller: Caller,
): Promise<BrandDetail | null> {
  const [row] = await db
    .select({
      id: brands.id,
      domain: brands.domain,
      url: brands.url,
      name: brands.name,
      logoUrl: brands.logoUrl,
      clickDestinationUrl: brandClickDestinations.clickDestinationUrl,
      createdAt: brands.createdAt,
      updatedAt: brands.updatedAt,
    })
    .from(brands)
    .leftJoin(
      brandClickDestinations,
      eq(brandClickDestinations.brandId, brands.id)
    )
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!row) return null;

  const name = row.name ?? (await ensureBrandName(row.id, caller));
  const logoUrl = row.logoUrl ?? (await ensureBrandLogoUrl(row.id));

  return {
    id: row.id,
    domain: row.domain,
    url: row.url,
    name,
    logoUrl,
    clickDestinationUrl: row.clickDestinationUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Guarantee brands.name is non-null for the given brandId.
 *
 * If brands.name is already set, returns it as-is. Otherwise derives the name
 * deterministically from the landing page HTML (og:site_name / <title> /
 * JSON-LD, falling back to the titlecased domain) and persists it. No LLM,
 * Firecrawl, chat-service, run, or cost is involved, so the return value is
 * always a non-empty string.
 *
 * @param caller — retained for signature stability (callers pass the route's
 *   tier). The deterministic fill does not use it.
 */
export async function ensureBrandName(
  brandId: string,
  caller?: Caller,
): Promise<string> {
  const row = await getBrandNameRow(brandId);

  if (!row) throw new Error(`Brand not found: ${brandId}`);
  if (row.name) return row.name;

  // Test environments bypass the network fetch. Persist domain as name so
  // callers still receive a non-null value deterministically.
  if (process.env.NODE_ENV === 'test') {
    await persistBrandName(brandId, row.domain);
    return row.domain;
  }

  const inFlight = inFlightBrandNameFills.get(brandId);
  if (inFlight) return inFlight;

  const fillPromise = fillBrandName(brandId).finally(() => {
    inFlightBrandNameFills.delete(brandId);
  });
  inFlightBrandNameFills.set(brandId, fillPromise);
  return fillPromise;
}

async function getBrandNameRow(brandId: string): Promise<Brand | null> {
  const [row] = await db
    .select({
      id: brands.id,
      name: brands.name,
      domain: brands.domain,
      url: brands.url,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  return row ?? null;
}

async function persistBrandName(brandId: string, name: string): Promise<void> {
  await db
    .update(brands)
    .set({ name, updatedAt: sql`NOW()` })
    .where(eq(brands.id, brandId));
}

async function fillBrandName(brandId: string): Promise<string> {
  const row = await getBrandNameRow(brandId);

  if (!row) throw new Error(`Brand not found: ${brandId}`);
  if (row.name) return row.name;

  if (process.env.NODE_ENV === 'test') {
    await persistBrandName(brandId, row.domain);
    return row.domain;
  }

  console.log(`[brand-service] ensureBrandName: deriving name for brand ${brandId} (${row.url})`);

  const name = await deriveBrandName(row.url, row.domain);
  await persistBrandName(brandId, name);

  console.log(`[brand-service] ensureBrandName: persisted name "${name}" for brand ${brandId}`);
  return name;
}

/**
 * Derive a brand display name with no LLM / external service. Fetches the
 * landing page HTML and parses it; on any fetch failure falls back to the
 * titlecased domain. Always returns a non-empty string.
 */
async function deriveBrandName(url: string, domain: string): Promise<string> {
  const html = await fetchLandingHtml(url);
  if (html === null) return titlecaseDomain(domain);
  return parseBrandNameFromHtml(html, domain);
}

async function fetchLandingHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAND_NAME_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BRAND_NAME_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      console.warn(`[brand-service] fillBrandName: fetch ${url} returned ${res.status}; using domain fallback`);
      return null;
    }
    return await res.text();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[brand-service] fillBrandName: fetch ${url} failed (${message}); using domain fallback`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Titlecase a bare domain into a human-ish name. Strips `www.` and the TLD
 * (everything from the first dot), splits the leading label on `-`/`_`, and
 * titlecases each token. Always returns a non-empty string.
 * e.g. "my-cool-brand.com" → "My Cool Brand", "acme.io" → "Acme".
 */
export function titlecaseDomain(domain: string): string {
  const label = domain.replace(/^www\./i, '').split('.')[0] ?? '';
  const name = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
  return name || domain;
}

/**
 * Derive a brand display name from raw landing-page HTML. Priority:
 *   1. og:site_name meta
 *   2. <title> (trailing " | tagline" / " – tagline" suffix trimmed)
 *   3. JSON-LD Organization / WebSite `.name`
 *   4. titlecased domain fallback (always non-empty)
 */
export function parseBrandNameFromHtml(html: string, domain: string): string {
  const ogSiteName = matchMetaContent(html, 'og:site_name');
  if (ogSiteName) return ogSiteName;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
    // Sites format titles as "Brand | Tagline" / "Brand – Tagline"; take the
    // leading segment when a spaced separator is present.
    const firstSegment = title.split(/\s*[|–—]\s+|\s+-\s+|:\s+/)[0]?.trim();
    if (firstSegment) return firstSegment;
    if (title) return title;
  }

  const jsonLdName = parseJsonLdName(html);
  if (jsonLdName) return jsonLdName;

  return titlecaseDomain(domain);
}

function matchMetaContent(html: string, key: string): string | null {
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    const prop = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (prop !== key) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    const decoded = content ? decodeEntities(content).trim() : '';
    if (decoded) return decoded;
  }
  return null;
}

function parseJsonLdName(html: string): string | null {
  const scriptRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const name = findOrgName(parsed);
    if (name) return name;
  }
  return null;
}

function findOrgName(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOrgName(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      const found = findOrgName(obj['@graph']);
      if (found) return found;
    }
    const rawType = obj['@type'];
    const types = (Array.isArray(rawType) ? rawType : [rawType]).map((t) => String(t ?? ''));
    const isOrgOrSite = types.some(
      (t) => t === 'Organization' || t === 'WebSite' || t === 'Corporation' || t === 'LocalBusiness',
    );
    if (isOrgOrSite && typeof obj.name === 'string' && obj.name.trim()) {
      return decodeEntities(obj.name).trim();
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/**
 * Guarantee brands.logo_url is non-null for the given brandId.
 *
 * If brands.logo_url is already set, returns it as-is.
 * Otherwise computes a deterministic logo.dev URL from the brand's domain,
 * persists it, and returns it. logo.dev returns a logo image for any domain;
 * no network call is required to compute the URL.
 */
export async function ensureBrandLogoUrl(brandId: string): Promise<string> {
  const [row] = await db
    .select({ id: brands.id, logoUrl: brands.logoUrl, domain: brands.domain })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!row) throw new Error(`Brand not found: ${brandId}`);
  if (row.logoUrl) return row.logoUrl;

  // Test environments bypass key-service. Persist a deterministic stub URL so
  // tests can verify the lazy-fill code path without a live key-service.
  const logoUrl = process.env.NODE_ENV === 'test'
    ? `https://img.logo.dev/${encodeURIComponent(row.domain)}?token=test-logo-dev-token&size=256&format=png`
    : await buildLogoDevUrl(row.domain);

  await db
    .update(brands)
    .set({ logoUrl, updatedAt: sql`NOW()` })
    .where(eq(brands.id, brandId));

  console.log(`[brand-service] ensureBrandLogoUrl: persisted logo.dev URL for brand ${brandId} (${row.domain})`);
  return logoUrl;
}

/**
 * Resolve a domain (or URL) to its GLOBAL silver brand identity, creating the
 * brand row if absent — WITHOUT claiming it for any org and WITHOUT scraping.
 *
 * Unlike `getOrCreateBrand`, this does NOT write `org_brands` membership and
 * does NOT call `ensureBrandName` (no Firecrawl / LLM). The returned `name` is
 * whatever is stored on the row — `null` until populated elsewhere. Used for
 * bulk-labelling org-agnostic reference data (e.g. competitor domains) where a
 * stable brandId is needed but a claim/scrape would be wrong.
 *
 * Throws `InvalidUrlError` / `UrlRequiredError` for unparseable input — the
 * caller is expected to catch and omit invalid entries from a batch.
 */
export async function resolveBrandByDomain(
  input: string,
): Promise<{ id: string; domain: string; name: string | null }> {
  const normalizedUrl = normalizeUrl(input);
  const domain = extractDomain(normalizedUrl);

  // CASE 1: brand already exists for this domain — return stored identity as-is.
  const existing = await db
    .select({ id: brands.id, domain: brands.domain, name: brands.name })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);
  if (existing.length > 0) return existing[0];

  // CASE 2: create the global brand row. Race-safe via ON CONFLICT on the
  // unique domain index; re-fetch on conflict (a concurrent insert won).
  const inserted = await db
    .insert(brands)
    .values({ url: normalizedUrl, domain })
    .onConflictDoNothing({ target: brands.domain })
    .returning({ id: brands.id, domain: brands.domain, name: brands.name });
  if (inserted.length > 0) return inserted[0];

  const [refetched] = await db
    .select({ id: brands.id, domain: brands.domain, name: brands.name })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);
  return refetched;
}

/**
 * Find the silver brand row for a normalized domain or create it, then
 * ensure `org_brands` membership exists for `(orgId, brand.id)` and
 * lazy-fill the brand name.
 *
 * The brand row itself is global (no org column). Membership tracking lives
 * in the `org_brands` gold table.
 */
export async function getOrCreateBrand(
  orgId: string,
  url: string,
  caller: OrgCaller,
): Promise<Brand> {
  const normalizedUrl = normalizeUrl(url);
  const domain = extractDomain(normalizedUrl);

  // CASE 1: brand already exists for this domain.
  const existing = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);

  let brand: Brand;
  if (existing.length > 0) {
    brand = existing[0];
    if (brand.url !== normalizedUrl) {
      await db.update(brands).set({ url: normalizedUrl, updatedAt: sql`NOW()` }).where(eq(brands.id, brand.id));
      brand.url = normalizedUrl;
    }
    console.log(`[brand-service] Found existing brand by domain ${domain}: ${brand.id}`);
  } else {
    // CASE 2: create new brand. Race-safe insert via ON CONFLICT on the unique domain index.
    const inserted = await db
      .insert(brands)
      .values({ url: normalizedUrl, domain })
      .onConflictDoNothing({ target: brands.domain })
      .returning({
        id: brands.id,
        url: brands.url,
        name: brands.name,
        domain: brands.domain,
      });

    if (inserted.length > 0) {
      brand = inserted[0];
      console.log(`[brand-service] Created NEW brand for domain ${domain}: ${brand.id}`);
    } else {
      const [refetched] = await db
        .select({ id: brands.id, url: brands.url, name: brands.name, domain: brands.domain })
        .from(brands)
        .where(eq(brands.domain, domain))
        .limit(1);
      brand = refetched;
      console.log(`[brand-service] Re-fetched brand after conflict for domain ${domain}: ${brand.id}`);
    }
  }

  // Upsert org_brands membership. Idempotent on (orgId, brandId).
  await db
    .insert(orgBrands)
    .values({ orgId, brandId: brand.id })
    .onConflictDoNothing({ target: [orgBrands.orgId, orgBrands.brandId] });

  // Do NOT block the create on the name fill — onboarding shows the domain, not
  // the name. The name is derived lazily on the first getBrandDetail read
  // (ensureBrandName). `brand.name` is returned as-is (may be null).
  return brand;
}
