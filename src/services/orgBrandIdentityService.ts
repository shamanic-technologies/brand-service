import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { titlecaseDomain } from './brandService';

/**
 * The minimum that identifies an org's brand to a human: something to display,
 * and something the dashboard can turn into a logo (it renders logos from a
 * DOMAIN, so a name alone leaves the logo slot empty).
 *
 * Deliberately NOT the brand detail shape — nothing about spend, campaigns,
 * performance or configuration. The consumer is showing a customer who referred
 * them, not opening a window onto another customer's business.
 */
export interface OrgBrandIdentity {
  orgId: string;
  brandId: string;
  /** Never null — see resolveDisplayName. */
  name: string;
  /** Normalized domain (www stripped), or null for a no-website brand. */
  domain: string | null;
}

/**
 * The display name of a brand row, or null when the row identifies nothing.
 *
 * A stored name always wins. A website brand whose name was never filled falls
 * back to its titlecased domain — a deterministic derivation of data the brand
 * actually has, not an invented placeholder. A row with neither is
 * unidentifiable and yields null so the caller can drop it rather than render
 * something wrong.
 */
export function resolveDisplayName(row: { name: string | null; domain: string | null }): string | null {
  if (row.name) return row.name;
  if (row.domain) return titlecaseDomain(row.domain);
  return null;
}

/**
 * Resolve a batch of org ids to one brand identity each.
 *
 * An org with no brand — or whose only brands identify nothing — is simply
 * absent from the result. There is no placeholder entry.
 *
 * **An org with several brands resolves to the one it claimed FIRST**
 * (`org_brands.claimed_at` ascending, ties broken by brand id ascending, so the
 * answer is total-ordered even when two claims share a timestamp). The first
 * brand an org claimed is the one it onboarded with, and the choice is stable:
 * every brand claimed later leaves the answer untouched, so a referral reward
 * keeps naming the same business for the life of the row.
 *
 * One indexed query (`org_brands_org_id_idx`), `DISTINCT ON (org_id)` — the
 * work is bounded by the ids asked for, not by the size of the platform.
 */
export async function getBrandIdentitiesByOrgIds(orgIds: string[]): Promise<OrgBrandIdentity[]> {
  if (orgIds.length === 0) return [];
  const uniqueOrgIds = Array.from(new Set(orgIds));

  const rows = await db
    .selectDistinctOn([orgBrands.orgId], {
      orgId: orgBrands.orgId,
      brandId: brands.id,
      name: brands.name,
      domain: brands.domain,
    })
    .from(orgBrands)
    .innerJoin(brands, eq(brands.id, orgBrands.brandId))
    .where(
      and(
        inArray(orgBrands.orgId, uniqueOrgIds),
        // A row that identifies nothing must not win the pick and then be
        // dropped — skip it here so the org still resolves via its next brand.
        or(isNotNull(brands.name), isNotNull(brands.domain)),
      ),
    )
    .orderBy(orgBrands.orgId, asc(orgBrands.claimedAt), asc(brands.id));

  const identities: OrgBrandIdentity[] = [];
  for (const row of rows) {
    const name = resolveDisplayName(row);
    if (name === null) continue;
    identities.push({ orgId: row.orgId, brandId: row.brandId, name, domain: row.domain });
  }
  return identities;
}
