import { Router, Request, Response } from 'express';
import { DeclareSalesFunnelRequestSchema, StateSalesFunnelSetRequestSchema } from '../schemas';
import {
  UUID_REGEX,
  resolveBrandOwnership,
  rejectOwnership,
} from '../lib/brand-ownership';
import { getBrand } from '../services/brandService';
import { isSalesFunnelKey, SalesFunnelKey } from '../services/salesFunnelCatalogue';
import {
  SalesFunnelDestinationNotUsedError,
  SalesFunnelRateNotInChainError,
  SalesFunnelRequiresWebsiteError,
  LastActiveSalesFunnelError,
  salesFunnelsService,
} from '../services/salesFunnelsService';
import { ClickDestinationValidationError } from '../services/clickDestinationService';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * The sales funnels a brand sells through, and the economics of each.
 *
 * The declared SET is the answer to "which ways does this brand sell?", and it
 * can only be declared — it is not derivable from anything else brand-service
 * stores, because every rate on `brand_sales_economics` is NOT NULL with a
 * server default, so a brand that configured nothing still reads back
 * plausible-looking numbers there and no absence signals anything.
 */

/** Resolve a funnel key from the path, or write the 400 and return null. */
function parseFunnelKey(req: Request, res: Response): SalesFunnelKey | null {
  const { funnelKey } = req.params;
  if (!isSalesFunnelKey(funnelKey)) {
    res.status(400).json({
      error:
        `Unknown sales funnel "${funnelKey}": expected one of reply_meeting, visit_meeting, ` +
        'visit_signup, visit_form',
    });
    return null;
  }
  return funnelKey;
}

/**
 * Map a declaration failure to its 400. Every one of these is the caller
 * describing a funnel that does not exist as described — never something to
 * clean up and store anyway.
 */
function rejectDeclaration(res: Response, error: unknown): boolean {
  if (
    error instanceof SalesFunnelRateNotInChainError ||
    error instanceof SalesFunnelDestinationNotUsedError ||
    error instanceof SalesFunnelRequiresWebsiteError ||
    error instanceof LastActiveSalesFunnelError ||
    error instanceof ClickDestinationValidationError
  ) {
    res.status(400).json({ error: (error as Error).message });
    return true;
  }
  return false;
}

/**
 * GET /orgs/brands/:brandId/sales-funnels
 * `{ declared, funnels }` — whether the brand has stated a set at all, and the
 * funnels in it. Read `declared` first: an empty list means opposite things
 * either side of it.
 */
orgRouter.get('/brands/:brandId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const set = await salesFunnelsService.readByBrandId(req.orgId!, brandId);
    return res.status(200).json(set);
  } catch (error: any) {
    console.error('[brand-service] Get sales funnels error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-funnels
 * State the WHOLE set: exactly these funnels, no others. Funnels already in the
 * set keep their economics; funnels dropped from it lose theirs with the
 * declaration.
 *
 * `{ funnelKeys: [] }` is legal and is the ONLY way a brand can say it sells
 * through nothing — which is a different answer from never having said anything,
 * and the reason this route exists alongside the per-funnel one.
 */
orgRouter.put('/brands/:brandId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = StateSalesFunnelSetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    let set;
    try {
      set = await salesFunnelsService.statesetByBrandId(
        req.orgId!,
        brandId,
        parsed.data.funnelKeys,
        brand.domain ?? null
      );
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }

    return res.status(200).json(set);
  } catch (error: any) {
    console.error('[brand-service] State sales funnel set error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-funnels/:funnelKey
 * Declare the funnel and write what the caller sent of its economics.
 * Idempotent; PARTIAL (omit = leave unchanged, `null` = clear).
 */
orgRouter.put('/brands/:brandId/sales-funnels/:funnelKey', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const funnelKey = parseFunnelKey(req, res);
    if (!funnelKey) return;

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = DeclareSalesFunnelRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // Ownership already proved the brand exists; its domain is what a page
    // destination must sit on, and its absence is what blocks a website-led funnel.
    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    let funnel;
    try {
      funnel = await salesFunnelsService.declareByBrandId(
        req.orgId!,
        brandId,
        funnelKey,
        parsed.data,
        brand.domain ?? null
      );
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }

    return res.status(200).json({ funnel });
  } catch (error: any) {
    console.error('[brand-service] Declare sales funnel error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * DELETE /orgs/brands/:brandId/sales-funnels/:funnelKey
 * Switch the funnel OFF. The row and its numbers SURVIVE, so switching it back
 * on returns what the user already entered. Refused when it is the last active
 * one. Returns the whole set so the caller renders what it just created.
 */
orgRouter.delete('/brands/:brandId/sales-funnels/:funnelKey', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const funnelKey = parseFunnelKey(req, res);
    if (!funnelKey) return;

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    try {
      await salesFunnelsService.deactivateByBrandId(req.orgId!, brandId, funnelKey);
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }
    const set = await salesFunnelsService.readByBrandId(req.orgId!, brandId);
    return res.status(200).json(set);
  } catch (error: any) {
    console.error('[brand-service] Undeclare sales funnel error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/brands/:brandId/sales-funnels
 * Service-auth read of the funnels a brand AUTHORIZES, keyed by brandId with no
 * org context — what campaign-service arbitration ranks over.
 *
 * A brand id we hold nothing for is a THIRD answer, and it 404s rather than
 * joining either of the other two. Serving `declared: false` for it would say
 * "this brand has told us nothing" about a brand that does not exist, which
 * reads to the caller as a producer gap to surface and wait on — when what it
 * actually has is a bad id, and no amount of waiting will fill it in.
 */
internalRouter.get('/brands/:brandId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    // An unknown or unclaimed brand simply has nothing configured. Unset is a
    // 200 with an empty set here, never a 404 — the same contract the internal
    // sales-economics read has always had.
    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;

    // ACTIVE only: a scheduler asking what this org sells through must never
    // rank a funnel the org switched off.
    const set = scope.orgId
      ? await salesFunnelsService.readActiveByBrandId(scope.orgId, brandId)
      : { funnels: [] };
    return res.status(200).json(set);
  } catch (error: any) {
    console.error('[brand-service] Internal get sales funnels error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
