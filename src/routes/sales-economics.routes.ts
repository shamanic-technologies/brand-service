import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { UpsertSalesEconomicsRequestSchema } from '../schemas';
import { salesEconomicsService } from '../services/salesEconomicsService';

export const orgRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OwnershipResult = 'ok' | 'not_found' | 'forbidden';

/**
 * Org-ownership enforcement for a brand-scoped route.
 * - 'not_found': the brand does not exist (→ 404, reserved for unknown brand).
 * - 'forbidden': the brand exists but is not claimed by the caller's org (→ 403).
 * - 'ok': the brand belongs to the caller's org.
 *
 * The leftJoin is filtered on the caller's orgId so a brand owned by ANOTHER
 * org returns a row with a null membership (→ forbidden), distinct from a
 * brand that doesn't exist at all (no row → not_found).
 */
async function resolveBrandOwnership(
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

function rejectOwnership(res: Response, ownership: OwnershipResult): boolean {
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

/**
 * GET /orgs/sales-economics-average
 * Cross-brand average of every saved set — seed defaults for a brand that has
 * saved nothing. GLOBAL: no org/brand filter (averages over the whole table,
 * per product decision). `{ averages: null }` when the table is empty.
 *
 * Org-scoped auth only (apiKeyAuth + requireOrgId at mount) — no brand-ownership
 * check (no brandId). Declared before the `/brands/:brandId/...` routes for
 * clarity; the paths do not collide (distinct first segment).
 */
orgRouter.get('/sales-economics-average', async (_req: Request, res: Response) => {
  try {
    const averages = await salesEconomicsService.getAverageAcrossBrands();
    return res.status(200).json({ averages });
  } catch (error: any) {
    console.error('[brand-service] Get sales economics average error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /orgs/brands/:brandId/sales-economics
 * Returns the saved 5-metric set, or { salesEconomics: null } when unset.
 */
orgRouter.get('/brands/:brandId/sales-economics', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const salesEconomics = await salesEconomicsService.getByBrandId(brandId);
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    console.error('[brand-service] Get sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-economics
 * Idempotent upsert of the full 5-metric set. Returns the saved set (non-null).
 */
orgRouter.put('/brands/:brandId/sales-economics', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = UpsertSalesEconomicsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const salesEconomics = await salesEconomicsService.upsertByBrandId(brandId, parsed.data);
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    console.error('[brand-service] Upsert sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
