import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { UpsertSalesEconomicsRequestSchema } from '../schemas';
import {
  IncompleteSalesEconomicsError,
  salesEconomicsService,
} from '../services/salesEconomicsService';
import {
  RetiredGoalNamesNoFunnelError,
  SalesFunnelRequiresWebsiteError,
} from '../services/salesFunnelsService';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';

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

    const { economics, source } = await salesEconomicsService.getEffectiveByBrandId(req.orgId!, brandId);
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

    const salesEconomics = await salesEconomicsService.getByBrandId(req.orgId!, brandId);
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    console.error('[brand-service] Get sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-economics
 * Idempotent PARTIAL upsert. Returns the saved set (non-null).
 *
 * Every field is optional: what the caller sends is written, what it OMITS is
 * left unchanged. So a screen editing one metric sends only that metric and
 * cannot clobber the rest with a stale copy of them. Sending the full set is
 * unchanged behaviour.
 *
 * A brand with NO stored economics has nothing to leave unchanged, so a partial
 * payload there is a 400 naming the missing core metrics — never a default and
 * never a cross-brand average.
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

    const salesEconomics = await salesEconomicsService.upsertByBrandId(req.orgId!, brandId, parsed.data);
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    // Partial payload on a brand that has nothing stored: the caller must send
    // the full core set. A client error, not a server one.
    if (error instanceof IncompleteSalesEconomicsError) {
      console.error('[brand-service] Upsert sales economics incomplete create:', error.message);
      return res.status(400).json({ error: error.message, missing: error.missing });
    }
    // A goal the caller sent that names no funnel, or a website-led funnel on a
    // brand with no website. The goal is retired, so what it MEANS is a funnel
    // declaration — one we cannot make is the caller describing something that
    // does not exist, not a server fault. Refuse rather than store economics
    // under a word that now says nothing.
    if (
      error instanceof RetiredGoalNamesNoFunnelError ||
      error instanceof SalesFunnelRequiresWebsiteError
    ) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[brand-service] Upsert sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/brands/:brandId/sales-economics
 * Internal api-key read of a brand's SAVED economics. Keyed by brandId, NO org
 * context.
 *
 * NO GOAL on the response. What a brand sells through is its declared sales
 * funnels (GET /internal/brands/:brandId/sales-funnels); the goal vocabulary is
 * retired because it could not tell the two meeting funnels apart.
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

    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;

    // No org claims the brand => nothing configured. Unset is a 200 with null
    // here (it always has been), never a 404.
    const salesEconomics = scope.orgId
      ? await salesEconomicsService.getByBrandId(scope.orgId, brandId)
      : null;
    return res.status(200).json({ salesEconomics });
  } catch (error: any) {
    console.error('[brand-service] Internal get sales economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
