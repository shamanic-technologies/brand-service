/**
 * Brand CRUD utilities.
 *
 * Only brand lookup/creation logic — no extraction, no AI, no scraping.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, brands } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';

interface Brand {
  id: string;
  url: string;
  name: string | null;
  domain: string;
}

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

export async function getOrCreateBrand(
  orgId: string,
  url: string,
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
    console.log(`[brand-service] Created NEW brand for org ${orgId} with domain ${domain}: ${inserted[0].id}`);
    return inserted[0];
  }

  // Race condition: another request inserted the same org+domain — re-fetch
  const [refetched] = await db
    .select({ id: brands.id, url: brands.url, name: brands.name, domain: brands.domain })
    .from(brands)
    .where(and(eq(brands.orgId, orgId), eq(brands.domain, domain)))
    .limit(1);

  console.log(`[brand-service] Re-fetched brand after conflict for org ${orgId}: ${refetched.id}`);
  return refetched;
}
