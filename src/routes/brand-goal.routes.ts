import { Router, Request, Response } from 'express';
import { UpdateCurrentGoalRequestSchema } from '../schemas';
import { getBrandDetail } from '../services/brandService';
import { brandProfileService } from '../services/brandProfileService';
import {
  getCurrentGoalByBrandId,
  hasClickDestination,
  toRetiredGoal,
  updateCurrentGoalByBrandId,
} from '../services/brandGoalService';
import {
  RetiredGoalNamesNoFunnelError,
  SalesFunnelRequiresWebsiteError,
  salesFunnelsService,
} from '../services/salesFunnelsService';
import { getBrand } from '../services/brandService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * PUT /orgs/brands/:brandId/current-goal
 *
 * RETIRED-GOAL WRITE TOLERANCE, and nothing more. The goal vocabulary no longer
 * answers anything: what a brand sells through is its declared sales funnels.
 * This route exists so a caller still sending yesterday's word keeps working —
 * it accepts every spelling the fleet has ever used (including the pre-rename
 * `purchase` it once required), declares the funnel(s) that goal MEANT, and
 * answers with the funnel set.
 *
 * The retired columns are still mirrored, so a caller that writes a goal and
 * reads it back is not lied to; nothing derives an answer from them.
 */
orgRouter.put('/brands/:brandId/current-goal', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = UpdateCurrentGoalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const goal = toRetiredGoal(parsed.data.currentGoal);

    // Mirror first: a membership that does not exist is the 404 this route has
    // always answered, and nothing should be declared for an org that does not
    // claim the brand.
    const mirrored = await updateCurrentGoalByBrandId(req.orgId!, brandId, goal);
    if (!mirrored) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    try {
      const set = await salesFunnelsService.declareFromRetiredGoal(
        req.orgId!,
        brandId,
        goal,
        { hasClickDestination: await hasClickDestination(req.orgId!, brandId) },
        brand.domain ?? null
      );
      return res.status(200).json(set);
    } catch (error) {
      if (
        error instanceof RetiredGoalNamesNoFunnelError ||
        error instanceof SalesFunnelRequiresWebsiteError
      ) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Declare from retired goal error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/brands/:brandId/runtime-context
 * Service-auth snapshot for one campaign loop: canonical runtime goal plus
 * current brand context. No selection/bandit logic lives here.
 */
internalRouter.get('/brands/:brandId/runtime-context', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const brand = await getBrandDetail(brandId, { mode: 'platform' });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // The goal and the confirmed profile are per (org, brand), and this route
    // carries no org. Resolve it the same way every other internal read does.
    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;

    // A brand no org claims has no runtime context to serve — the 404 this
    // route already returned for an unresolvable goal.
    const currentGoal = scope.orgId
      ? await getCurrentGoalByBrandId(scope.orgId, brandId)
      : null;
    if (!currentGoal || !scope.orgId) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const profile = await brandProfileService.getByBrandId(scope.orgId, brandId);

    return res.status(200).json({
      brand,
      currentGoal,
      // Backward-compatible with the pre-2-layer shape campaign-service consumes
      // (brand-runtime-client + audience bandit read `brandProfile?.id`). There
      // are no version rows anymore → `id`/`version` are null; `fields` is the
      // confirmed-overlaid-on-derived profile. Consumers read `.id` null-safe.
      brandProfile: {
        id: null,
        brandId,
        version: null,
        fields: profile.current.fields,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[brand-service] Get runtime context error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
