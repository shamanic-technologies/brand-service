import { eq, and } from 'drizzle-orm';
import { db, orgs } from '../db';

/**
 * Resolve an org UUID from clerkOrgId + appId.
 * Throws if the org doesn't exist.
 */
export async function resolveOrgId(clerkOrgId: string, appId = 'mcpfactory'): Promise<string> {
  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(eq(orgs.appId, appId), eq(orgs.clerkOrgId, clerkOrgId)))
    .limit(1);

  if (!org) {
    throw new Error(`Org not found for clerkOrgId=${clerkOrgId}, appId=${appId}`);
  }

  return org.id;
}

/**
 * Resolve an org UUID from clerkOrgId + appId.
 * Returns null if the org doesn't exist.
 */
export async function resolveOrgIdOptional(clerkOrgId: string, appId = 'mcpfactory'): Promise<string | null> {
  const [org] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(and(eq(orgs.appId, appId), eq(orgs.clerkOrgId, clerkOrgId)))
    .limit(1);

  return org?.id ?? null;
}
