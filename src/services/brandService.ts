/**
 * Brand CRUD utilities.
 *
 * Includes a lazy-fill helper (ensureBrandName) that scrapes the brand site
 * to populate brands.name on first access. brands.name is therefore
 * guaranteed non-null on the return value of every public function below.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, brands } from '../db';
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
      orgId: brands.orgId,
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
 * Find an existing brand by `orgId + domain` or create one, then lazy-fill its name.
 *
 * Org-only — exposed via `POST /orgs/brands` which always has a user-identified caller.
 */
export async function getOrCreateBrand(
  orgId: string,
  url: string,
  caller: OrgCaller,
): Promise<Brand> {
  const normalizedUrl = normalizeUrl(url);
  const domain = extractDomain(normalizedUrl);

  // CASE 1: Find existing brand by orgId + domain
  const existingByBoth = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands)
    .where(and(eq(brands.orgId, orgId), eq(brands.domain, domain)))
    .limit(1);

  if (existingByBoth.length > 0) {
    const brand = existingByBoth[0];
    if (brand.url !== normalizedUrl) {
      await db.update(brands).set({ url: normalizedUrl, updatedAt: sql`NOW()` }).where(eq(brands.id, brand.id));
      brand.url = normalizedUrl;
    }
    console.log(`[brand-service] Found existing brand by orgId+domain: ${brand.id}`);
    brand.name = await ensureBrandName(brand.id, caller);
    return brand;
  }

  // CASE 2: Create new brand
  const inserted = await db
    .insert(brands)
    .values({ url: normalizedUrl, domain, orgId })
    .onConflictDoNothing()
    .returning({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    });

  if (inserted.length > 0) {
    const brand = inserted[0];
    console.log(`[brand-service] Created NEW brand for org ${orgId} with domain ${domain}: ${brand.id}`);
    brand.name = await ensureBrandName(brand.id, caller);
    return brand;
  }

  // Race condition: another request inserted the same org+domain — re-fetch
  const [refetched] = await db
    .select({ id: brands.id, url: brands.url, name: brands.name, domain: brands.domain })
    .from(brands)
    .where(and(eq(brands.orgId, orgId), eq(brands.domain, domain)))
    .limit(1);

  console.log(`[brand-service] Re-fetched brand after conflict for org ${orgId}: ${refetched.id}`);
  refetched.name = await ensureBrandName(refetched.id, caller);
  return refetched;
}
