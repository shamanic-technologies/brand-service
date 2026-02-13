import { eq, and, sql } from 'drizzle-orm';
import { db, brands, orgs } from '../db';
import { resolveOrCreateOrg } from './salesProfileExtractionService';

/**
 * Extracts domain from URL using JavaScript (matches SQL extract_domain_from_url)
 */
function extractDomainFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] || null;
  }
}

/**
 * Gets or creates a brand by Clerk organization ID and returns its internal UUID.
 * Resolves org first, then queries brands by orgId.
 */
export const getOrganizationIdByClerkId = async (
  clerkOrganizationId: string,
  organizationName?: string,
  organizationUrl?: string,
  externalOrganizationId?: string
): Promise<string> => {
  try {
    console.log(`[BRAND UPSERT] Starting upsert for clerk_org_id: ${clerkOrganizationId}`);
    console.log(`[BRAND UPSERT] Params: name=${organizationName}, url=${organizationUrl}`);

    // Resolve or create org
    const org = await resolveOrCreateOrg('mcpfactory', clerkOrganizationId);

    // Check if brand exists by orgId
    const existingByOrg = await db
      .select({ id: brands.id, domain: brands.domain })
      .from(brands)
      .where(eq(brands.orgId, org.id))
      .limit(1);

    // Check if brand exists by domain
    const domain = organizationUrl ? extractDomainFromUrl(organizationUrl) : null;
    let existingByDomain: { id: string; orgId: string } | null = null;

    if (domain) {
      const domainResult = await db
        .select({ id: brands.id, orgId: brands.orgId })
        .from(brands)
        .where(eq(brands.domain, domain))
        .limit(1);
      if (domainResult.length > 0) {
        existingByDomain = domainResult[0];
      }
    }

    // CASE 1: Brand exists by orgId AND different brand exists by domain -> merge
    if (existingByOrg.length > 0 && existingByDomain && existingByDomain.id !== existingByOrg[0].id) {
      console.log(`[BRAND UPSERT] Found duplicate. Merging...`);

      // Delete skeleton (org brand without domain)
      if (!existingByOrg[0].domain) {
        await db.delete(brands).where(eq(brands.id, existingByOrg[0].id));
        console.log(`[BRAND UPSERT] Deleted skeleton brand: ${existingByOrg[0].id}`);
      }

      // Update domain brand with orgId
      const result = await db
        .update(brands)
        .set({
          orgId: org.id,
          externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
          name: organizationName || sql`${brands.name}`,
          url: organizationUrl || sql`${brands.url}`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(brands.id, existingByDomain.id))
        .returning({ id: brands.id });

      console.log(`[BRAND UPSERT] Merged into domain brand:`, result[0]?.id);
      return result[0].id;
    }

    // CASE 2: Brand exists by orgId only -> update the first match
    if (existingByOrg.length > 0) {
      const result = await db
        .update(brands)
        .set({
          externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
          name: organizationName || sql`${brands.name}`,
          url: organizationUrl || sql`${brands.url}`,
          domain: domain || sql`${brands.domain}`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(brands.id, existingByOrg[0].id))
        .returning({ id: brands.id });

      console.log(`[BRAND UPSERT] Updated existing brand by orgId:`, result[0]?.id);
      return result[0].id;
    }

    // CASE 3: Brand exists by domain only -> update with orgId
    if (existingByDomain) {
      const result = await db
        .update(brands)
        .set({
          orgId: org.id,
          externalOrganizationId: externalOrganizationId || sql`${brands.externalOrganizationId}`,
          name: organizationName || sql`${brands.name}`,
          url: organizationUrl || sql`${brands.url}`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(brands.id, existingByDomain.id))
        .returning({ id: brands.id });

      console.log(`[BRAND UPSERT] Updated existing brand by domain:`, result[0]?.id);
      return result[0].id;
    }

    // CASE 4: No existing brand -> create new
    const result = await db
      .insert(brands)
      .values({
        orgId: org.id,
        externalOrganizationId: externalOrganizationId || null,
        name: organizationName || null,
        url: organizationUrl || null,
        domain: domain,
      })
      .returning({ id: brands.id });

    console.log(`[BRAND UPSERT] Created new brand:`, result[0]?.id);
    return result[0].id;
  } catch (error: any) {
    console.error('[BRAND UPSERT] Error:', error);
    throw error;
  }
};

/**
 * @deprecated Use getOrganizationIdByClerkId instead.
 * Gets or creates a brand by external ID (press-funnel UUID).
 * Note: This creates brands without an org link — caller should ensure org exists.
 */
export const getOrganizationIdByExternalId = async (
  externalOrganizationId: string,
  organizationName?: string,
  organizationUrl?: string
): Promise<string> => {
  try {
    console.log(`[BRAND UPSERT] [DEPRECATED] Starting upsert for external_org_id: ${externalOrganizationId}`);

    const domain = organizationUrl ? extractDomainFromUrl(organizationUrl) : null;

    // Check if brand exists by external_organization_id
    const existing = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.externalOrganizationId, externalOrganizationId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      const result = await db
        .update(brands)
        .set({
          name: organizationName || sql`${brands.name}`,
          url: organizationUrl || sql`${brands.url}`,
          domain: domain || sql`${brands.domain}`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(brands.id, existing[0].id))
        .returning({ id: brands.id });

      return result[0].id;
    }

    // Create new — use a system org for unowned brands
    const systemOrg = await resolveOrCreateOrg('mcpfactory', 'system');

    const result = await db
      .insert(brands)
      .values({
        orgId: systemOrg.id,
        externalOrganizationId,
        name: organizationName || null,
        url: organizationUrl || null,
        domain: domain,
      })
      .returning({ id: brands.id });

    return result[0].id;
  } catch (error: any) {
    console.error('[BRAND UPSERT] [DEPRECATED] Error:', error);
    throw error;
  }
};
