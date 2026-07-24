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
import { db, brands, orgBrands, brandClickDestinations, brandWhatsappLinks } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';
import { Caller, OrgCaller } from '../lib/chat-client';
import { buildLogoDevUrl } from '../lib/logo-dev';

interface Brand {
  id: string;
  // NULLABLE — a no-website brand has neither url nor domain (identified by name).
  url: string | null;
  name: string | null;
  domain: string | null;
}

export interface BrandDetail {
  id: string;
  // NULLABLE — a no-website brand has no domain / url. Consumers must handle null
  // (the brand is identified by `name`, which is always non-null here).
  domain: string | null;
  url: string | null;
  name: string;
  // NULLABLE — the deterministic logo.dev fill needs a domain; a no-website brand
  // (domain null) has no logo, so this stays null.
  logoUrl: string | null;
  // Page outreach clicks should land on. Defaults to the brand's own landing URL
  // (`url`) when the brand has no saved override, so a website brand's
  // `.clickDestinationUrl` is always a valid href. NULLABLE only for a no-website
  // brand (url null) with no override set — there is no landing URL to fall back
  // to. The default is computed on read (free), not persisted — the
  // click-destinations row's presence remains the "user-set" signal. Per-brand
  // config, mirrors sales-economics scoping — never on the brand identity row.
  clickDestinationUrl: string | null;
  // The brand's WhatsApp link — the click destination for the "maximize
  // WhatsApp conversations" goal. `null` when unset: unlike clickDestinationUrl
  // there is no sensible default (a brand may have no WhatsApp), so the row's
  // presence is the only "set" signal. Per-brand config, mirrors
  // click-destination scoping — never on the brand identity row.
  whatsAppLink: string | null;
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
      whatsAppLink: brandWhatsappLinks.whatsappLink,
      createdAt: brands.createdAt,
      updatedAt: brands.updatedAt,
    })
    .from(brands)
    .leftJoin(
      brandClickDestinations,
      eq(brandClickDestinations.brandId, brands.id)
    )
    .leftJoin(
      brandWhatsappLinks,
      eq(brandWhatsappLinks.brandId, brands.id)
    )
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!row) return null;

  const name = row.name ?? (await ensureBrandName(row.id, caller));
  // Logo fill is deterministic from the domain; a no-website brand (domain null)
  // has no logo, so it stays null rather than fabricating one.
  const logoUrl = row.logoUrl ?? (row.domain ? await ensureBrandLogoUrl(row.id) : null);

  return {
    id: row.id,
    domain: row.domain,
    url: row.url,
    name,
    logoUrl,
    // Website brands fall back to their own landing URL so the click destination
    // is never empty. A no-website brand (url null) with no override has no
    // sensible landing fallback → null.
    clickDestinationUrl: row.clickDestinationUrl ?? row.url,
    // No sensible default (a brand may have no WhatsApp) — null when unset.
    whatsAppLink: row.whatsAppLink ?? null,
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

  // A no-website brand (url null) always has a user-provided name set at create,
  // so it returns above. If we reach here with no name AND no URL, there is no
  // source to derive a name from — fail loud rather than fabricate one.
  if (!row.url) {
    throw new Error(
      `Cannot derive name for brand ${brandId}: no stored name and no website URL to extract one from`,
    );
  }

  // Test environments bypass the network fetch. Persist domain as name so
  // callers still receive a non-null value deterministically.
  if (process.env.NODE_ENV === 'test') {
    const fallback = row.domain ?? extractDomain(row.url);
    await persistBrandName(brandId, fallback);
    return fallback;
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

  if (!row.url) {
    throw new Error(
      `Cannot derive name for brand ${brandId}: no stored name and no website URL to extract one from`,
    );
  }

  const domainFallback = row.domain ?? extractDomain(row.url);

  if (process.env.NODE_ENV === 'test') {
    await persistBrandName(brandId, domainFallback);
    return domainFallback;
  }

  console.log(`[brand-service] ensureBrandName: deriving name for brand ${brandId} (${row.url})`);

  const name = await deriveBrandName(row.url, domainFallback);
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
  // The logo.dev URL is derived from the domain; a no-website brand (domain null)
  // has no logo. Callers must gate on `domain` before invoking this — fail loud
  // rather than fabricate a logo for a domain-less brand.
  if (!row.domain) {
    throw new Error(`Cannot build logo URL for brand ${brandId}: brand has no domain`);
  }

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
  // `domain` is a real, non-null domain here (derived from the input), so the
  // stored row's domain is non-null too — return the const to satisfy the type.
  if (existing.length > 0) return { id: existing[0].id, domain, name: existing[0].name };

  // CASE 2: create the global brand row. Race-safe via ON CONFLICT on the
  // unique domain index; re-fetch on conflict (a concurrent insert won).
  const inserted = await db
    .insert(brands)
    .values({ url: normalizedUrl, domain })
    .onConflictDoNothing({ target: brands.domain })
    .returning({ id: brands.id, domain: brands.domain, name: brands.name });
  if (inserted.length > 0) return { id: inserted[0].id, domain, name: inserted[0].name };

  const [refetched] = await db
    .select({ id: brands.id, domain: brands.domain, name: brands.name })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);
  return { id: refetched.id, domain, name: refetched.name };
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

/** Thrown when adding a website to a brand collides with an existing brand's domain. */
export class BrandDomainConflictError extends Error {
  readonly code = 'DOMAIN_CONFLICT';
  constructor(domain: string) {
    super(`A brand already exists for domain "${domain}"`);
    this.name = 'BrandDomainConflictError';
  }
}

/**
 * Create a brand that has NO website — identified by a user-provided display
 * `name` instead of a URL. `url` and `domain` are left null; the extraction
 * source is the pasted business context (brand_business_context), not a scrape.
 *
 * Unlike `getOrCreateBrand`, there is NO domain-based dedup: a no-website brand
 * has no domain, so every call creates a distinct row (two nameless-domain
 * businesses are genuinely distinct identities). Membership in `org_brands` is
 * written for the calling org.
 */
export async function createBrandWithoutWebsite(
  orgId: string,
  name: string,
): Promise<Brand> {
  const [inserted] = await db
    .insert(brands)
    .values({ name, url: null, domain: null })
    .returning({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    });

  await db
    .insert(orgBrands)
    .values({ orgId, brandId: inserted.id })
    .onConflictDoNothing({ target: [orgBrands.orgId, orgBrands.brandId] });

  console.log(`[brand-service] Created NEW no-website brand "${name}": ${inserted.id}`);
  return inserted;
}

/**
 * Attach a website to an existing brand (e.g. a no-website brand whose user later
 * adds their site). Normalizes the URL, derives the domain, and persists both on
 * the brand identity row.
 *
 * The extraction source-switch is automatic and rides the EXISTING field cache:
 * `extractFields` reads `brands.url` fresh on every call, so once the URL is set,
 * the next post-cache-expiry extraction re-sources from the site — no new
 * TTL/cron. Throws `BrandDomainConflictError` if the derived domain is already
 * claimed by a different brand row.
 */
export async function updateBrandWebsite(
  brandId: string,
  url: string,
): Promise<Brand> {
  const normalizedUrl = normalizeUrl(url);
  const domain = extractDomain(normalizedUrl);

  // Reject if another brand already owns this domain (the unique index would
  // 23505 anyway; check first for a clean 409).
  const [clash] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.domain, domain))
    .limit(1);
  if (clash && clash.id !== brandId) {
    throw new BrandDomainConflictError(domain);
  }

  const [updated] = await db
    .update(brands)
    .set({ url: normalizedUrl, domain, updatedAt: sql`NOW()` })
    .where(eq(brands.id, brandId))
    .returning({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    });

  if (!updated) throw new Error(`Brand not found: ${brandId}`);

  console.log(`[brand-service] Attached website ${normalizedUrl} (domain ${domain}) to brand ${brandId}`);
  return updated;
}
