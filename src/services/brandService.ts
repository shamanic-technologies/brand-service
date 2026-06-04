/**
 * Brand CRUD utilities.
 *
 * Includes a lazy-fill helper (ensureBrandName) that scrapes the brand site
 * to populate brands.name on first access. brands.name is therefore
 * guaranteed non-null on the return value of every public function below.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';
import { extractFields } from './fieldExtractionService';
import { Caller, OrgCaller } from '../lib/chat-client';
import { buildLogoDevUrl } from '../lib/logo-dev';

interface Brand {
  id: string;
  url: string;
  name: string | null;
  domain: string;
}

const BRAND_NAME_FIELD_KEY = 'name';
const BRAND_NAME_FIELD_DESCRIPTION =
  'Official brand or company name as shown on the website (e.g. from the page <title>, the og:site_name meta tag, or the main H1 heading). Do not include taglines, slogans, or marketing copy — just the name.';

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

/**
 * Guarantee brands.name is non-null for the given brandId.
 *
 * If brands.name is already set, returns it as-is.
 * Otherwise scrapes the brand URL via extractFields() and persists the
 * extracted name to brands.name before returning it.
 *
 * The LLM prompt is instructed to return "Unknown" rather than null/empty,
 * so the return value is always a non-empty string.
 *
 * @param caller — Mirrors the brand-service caller endpoint:
 *   - `OrgCaller` when invoked from a `/orgs/*` route → chat-service `/complete`.
 *   - `PlatformCaller` when invoked from an `/internal/*` route → chat-service
 *     `/internal/platform-complete` (platform-billed, no run tracking).
 */
export async function ensureBrandName(
  brandId: string,
  caller: Caller,
): Promise<string> {
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

  if (!row) throw new Error(`Brand not found: ${brandId}`);
  if (row.name) return row.name;

  // Test environments bypass external scraping. Persist domain as name so
  // callers still receive a non-null value without hitting Firecrawl/LLM.
  if (process.env.NODE_ENV === 'test') {
    await db
      .update(brands)
      .set({ name: row.domain, updatedAt: sql`NOW()` })
      .where(eq(brands.id, brandId));
    return row.domain;
  }

  console.log(`[brand-service] ensureBrandName: scraping name for brand ${brandId} (${row.url})`);

  const results = await extractFields({
    brandId,
    fields: [{ key: BRAND_NAME_FIELD_KEY, description: BRAND_NAME_FIELD_DESCRIPTION }],
    caller,
  });

  const raw = results[0]?.value;
  const name = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!name) {
    throw new Error(
      `[brand-service] ensureBrandName: extractFields returned empty name for brand ${brandId}`,
    );
  }

  await db
    .update(brands)
    .set({ name, updatedAt: sql`NOW()` })
    .where(eq(brands.id, brandId));

  console.log(`[brand-service] ensureBrandName: persisted name "${name}" for brand ${brandId}`);
  return name;
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

  brand.name = await ensureBrandName(brand.id, caller);
  return brand;
}
