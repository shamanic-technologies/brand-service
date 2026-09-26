import { Router, Request, Response } from 'express';
import { getBrandDetail } from '../services/brandService';
import { brandProfileService } from '../services/brandProfileService';
import { getCurrentGoalByBrandId } from '../services/brandGoalService';
import { rejectOfferProblem } from '../lib/offer-scope';
import { UUID_REGEX } from '../lib/brand-ownership';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';

export const orgRouter = Router();
export const internalRouter = Router();

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

    // WHICH offer's confirmed words this snapshot carries. campaign-service
    // holds the campaign, and a campaign belongs to an offer, so the caller is
    // the one that can name it — `?offerId=`. Omitted keeps today's answer for
    // every brand selling one thing; a brand selling several answers 409
    // SEVERAL_OFFERS until the loop names which proposition it is running.
    const rawOfferId = req.query.offerId;
    const offerId = typeof rawOfferId === 'string' && rawOfferId.length > 0 ? rawOfferId : undefined;
    if (offerId !== undefined && !UUID_REGEX.test(offerId)) {
      return res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
    }

    const profile = await brandProfileService.getByBrandId(scope.orgId, brandId, offerId);

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
    // A named offer that names nothing (404), and the deliberate 409 for a
    // brand selling several when the caller named none.
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] Get runtime context error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
