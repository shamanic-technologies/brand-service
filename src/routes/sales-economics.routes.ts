import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { UpsertSalesEconomicsRequestSchema } from '../schemas';
import { salesEconomicsService } from '../services/salesEconomicsService';

export const orgRouter = Router();
export const internalRouter = Router();

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
 * GET /orgs/brands/:brandId/sales-economics-effective
 * Gold serving layer — the economics to USE for this brand:
 *   - saved 5-metric set if the brand has one      → source "user"
 *   - else the cross-brand average (median LTV,
 *     mean of the 4 percents)                       → source "cross-brand-average"
 *   - else (no brand has saved anything, cold start) → economics null, source null
 *
 * Centralizes the null→average defaulting that consumers (features-service,
 * dashboard) used to each reimplement. `source` is the provenance so a caller
 * can mark an estimate as an estimate — never present an average as a real value.
 *
 * Same auth as the per-brand GET: org-scoped + brand must belong to the caller's
 * org (400 bad uuid / 404 unknown brand / 403 foreign brand).
 */
orgRouter.get('/brands/:brandId/sales-economics-effective', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const { economics, source } = await salesEconomicsService.getEffectiveByBrandId(brandId);
    return res.status(200).json({ economics, source });
  } catch (error: any) {
    console.error('[brand-service] Get effective sales economics error:', error);
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

/**
 * GET /internal/brands/:brandId/sales-economics
 * Internal api-key read of a brand's SAVED economics — incl. `optimizationGoal`,
 * the brand's current optimization goal. Keyed by brandId, NO org context:
 * campaign-service (a scheduler running as a service) calls this once per loop
 * to read the goal that drives per-lead workflow + persona selection.
 *
 * Returns the brand's OWN saved set (not the cross-brand-average effective one —
 * a brand's goal must be the brand's, never an average). `{ salesEconomics: null }`
 * when the brand has never saved economics.
 */
internalRouter.get('/brands/:brandId/sales-economics', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const salesEconomics = await salesEconomicsService.getByBrandId(brandId);
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    console.error('[brand-service] Internal get sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
