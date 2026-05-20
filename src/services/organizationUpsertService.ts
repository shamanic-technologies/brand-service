import { eq, and, sql } from 'drizzle-orm';
// LEGACY: this service still upserts brands_old with org_id semantics.
// It powers /internal/by-org-id and related "treat-brand-row-as-org" endpoints,
// which must migrate to the new brands + org_brands model in a follow-up PR.
import { db, brandsOld as brands } from '../db';
import { extractDomain, normalizeUrl, UrlRequiredError } from '../lib/url-utils';

/**
 * Gets or creates a brand by organization ID and returns its internal UUID.
 * Uses orgId directly as brands.org_id (no orgs table indirection).
 *
 * Throws UrlRequiredError when no existing brand is found and no URL is provided —
 * creating a new brand requires a valid URL so domain is always set.
 */
export const getOrganizationIdByOrgId = async (
  organizationId: string,
  organizationName?: string,
  organizationUrl?: string,
  externalOrganizationId?: string,
): Promise<string> => {
  console.log(`[brand-service] upsert org_id=${organizationId} name=${organizationName ?? '-'} url=${organizationUrl ?? '-'}`);

  const normalizedUrl = organizationUrl ? normalizeUrl(organizationUrl) : undefined;
  const domain = normalizedUrl ? extractDomain(normalizedUrl) : undefined;

  // Check if brand exists by orgId
  const existingByOrg = await db
    .select({ id: brands.id, domain: brands.domain })
    .from(brands)
    .where(eq(brands.orgId, organizationId))
    .limit(1);

  // Check if brand exists by domain (within this org)
  let existingByDomain: { id: string; orgId: string } | null = null;
  if (domain) {
    const domainResult = await db
      .select({ id: brands.id, orgId: brands.orgId })
      .from(brands)
      .where(and(eq(brands.domain, domain), eq(brands.orgId, organizationId)))
      .limit(1);
    if (domainResult.length > 0) {
      existingByDomain = domainResult[0];
    }
  }

  // CASE 1: Brand exists by orgId AND different brand exists by domain -> merge into domain brand
  if (existingByOrg.length > 0 && existingByDomain && existingByDomain.id !== existingByOrg[0].id) {
    console.log(`[brand-service] upsert: merging duplicate brands (org+domain)`);

    const result = await db
      .update(brands)
      .set({
        orgId: organizationId,
        externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
        name: organizationName || sql`${brands.name}`,
        url: normalizedUrl || sql`${brands.url}`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(brands.id, existingByDomain.id))
      .returning({ id: brands.id });

    console.log(`[brand-service] upsert: merged into domain brand ${result[0]?.id}`);
    return result[0].id;
  }

  // CASE 2: Brand exists by orgId only -> update the first match
  if (existingByOrg.length > 0) {
    const result = await db
      .update(brands)
      .set({
        externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
        name: organizationName || sql`${brands.name}`,
        url: normalizedUrl || sql`${brands.url}`,
        domain: domain || sql`${brands.domain}`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(brands.id, existingByOrg[0].id))
      .returning({ id: brands.id });

    console.log(`[brand-service] upsert: updated existing brand by orgId ${result[0]?.id}`);
    return result[0].id;
  }

  // CASE 3: Brand exists by domain only -> update with orgId
  if (existingByDomain) {
    const result = await db
      .update(brands)
      .set({
        orgId: organizationId,
        externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
        name: organizationName || sql`${brands.name}`,
        url: normalizedUrl || sql`${brands.url}`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(brands.id, existingByDomain.id))
      .returning({ id: brands.id });

    console.log(`[brand-service] upsert: updated existing brand by domain ${result[0]?.id}`);
    return result[0].id;
  }

  // CASE 4: No existing brand -> create new. Requires URL.
  if (!normalizedUrl || !domain) {
    throw new UrlRequiredError(
      `Cannot create brand for org ${organizationId}: URL is required.`,
    );
  }

  const result = await db
    .insert(brands)
    .values({
      orgId: organizationId,
      externalOrganizationId: externalOrganizationId || null,
      name: organizationName || null,
      url: normalizedUrl,
      domain,
    })
    .returning({ id: brands.id });

  console.log(`[brand-service] upsert: created new brand ${result[0]?.id}`);
  return result[0].id;
};

/**
 * @deprecated Use getOrganizationIdByOrgId instead.
 * Gets or creates a brand by external ID (press-funnel UUID).
 * Throws UrlRequiredError when no existing brand is found and no URL is provided.
 */
export const getOrganizationIdByExternalId = async (
  externalOrganizationId: string,
  organizationName?: string,
  organizationUrl?: string,
): Promise<string> => {
  console.log(`[brand-service] [deprecated] upsert external_org_id=${externalOrganizationId}`);

  const normalizedUrl = organizationUrl ? normalizeUrl(organizationUrl) : undefined;
  const domain = normalizedUrl ? extractDomain(normalizedUrl) : undefined;

  const existing = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.externalOrganizationId, externalOrganizationId))
    .limit(1);

  if (existing.length > 0) {
    const result = await db
      .update(brands)
      .set({
        name: organizationName || sql`${brands.name}`,
        url: normalizedUrl || sql`${brands.url}`,
        domain: domain || sql`${brands.domain}`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(brands.id, existing[0].id))
      .returning({ id: brands.id });

    return result[0].id;
  }

  if (!normalizedUrl || !domain) {
    throw new UrlRequiredError(
      `Cannot create brand for external_org ${externalOrganizationId}: URL is required.`,
    );
  }

  const result = await db
    .insert(brands)
    .values({
      orgId: 'system',
      externalOrganizationId,
      name: organizationName || null,
      url: normalizedUrl,
      domain,
    })
    .returning({ id: brands.id });

  return result[0].id;
};
