import { eq, and } from 'drizzle-orm';
import { db, orgs } from '../db';

/**
 * Resolve an org UUID from orgId + appId.
 * Throws if the org doesn't exist.
 */
export async function resolveOrgId(orgId: string, appId: string): Promise<string> {
  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(eq(orgs.appId, appId), eq(orgs.orgId, orgId)))
    .limit(1);

  if (!org) {
    throw new Error(`Org not found for orgId=${orgId}, appId=${appId}`);
  }

  return org.id;
}

/**
 * Resolve an org UUID from orgId + appId.
 * Returns null if the org doesn't exist.
 */
export async function resolveOrgIdOptional(orgId: string, appId: string): Promise<string | null> {
  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(eq(orgs.appId, appId), eq(orgs.orgId, orgId)))
    .limit(1);

  return org?.id ?? null;
}
