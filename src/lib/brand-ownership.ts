import { Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';

/**
 * Shared org-ownership enforcement for brand-scoped /orgs routes.
 * Mirrors the logic that originated in sales-economics.routes.ts so ICP +
 * brand-profile routes enforce the exact same 400/404/403 semantics.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OwnershipResult = 'ok' | 'not_found' | 'forbidden';

/**
 * - 'not_found': the brand does not exist (→ 404, reserved for unknown brand).
 * - 'forbidden': the brand exists but is not claimed by the caller's org (→ 403).
 * - 'ok': the brand belongs to the caller's org.
 *
 * The leftJoin is filtered on the caller's orgId so a brand owned by ANOTHER
 * org returns a row with a null membership (→ forbidden), distinct from a
 * brand that doesn't exist at all (no row → not_found).
 */
export async function resolveBrandOwnership(
  brandId: string,
  orgId: string
): Promise<OwnershipResult> {
  const [row] = await db
    .select({ brandId: brands.id, ownedBy: orgBrands.orgId })
    .from(brands)
    .leftJoin(
      orgBrands,
      and(eq(orgBrands.brandId, brands.id), eq(orgBrands.orgId, orgId))
    )
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!row) return 'not_found';
  if (!row.ownedBy) return 'forbidden';
  return 'ok';
}

/**
 * Writes the 404/403 response for a rejected ownership and returns true; returns
 * false when ownership is 'ok' (caller proceeds).
 */
export function rejectOwnership(res: Response, ownership: OwnershipResult): boolean {
  if (ownership === 'not_found') {
    res.status(404).json({ error: 'Brand not found' });
    return true;
  }
  if (ownership === 'forbidden') {
    res.status(403).json({ error: "Brand does not belong to the caller's org" });
    return true;
  }
  return false;
}
